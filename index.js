var RedisSpawn = require('redis-spawn')
  , _ = require('underscore')
  , when = require('when')
  , sequence = require('when/sequence');

var Engine = function(server, options) {
  this._server  = server;
  this._options = options || {};

  var redis = require('redis')
    , gc = this._options.gc || this.DEFAULT_GC

  var cluster = this._options.cluster;

  this._normalCluster = new RedisSpawn(cluster, {no_ready_check: true});
  this._subscriberCluster = new RedisSpawn(cluster, {no_ready_check: true});

  this._ns  = this._options.namespace || '';

  this._messageChannel = this._ns + '/notifications/messages';
  this._closeChannel   = this._ns + '/notifications/close';

  this._subscriberCluster.each(function(instance){
    instance.subscribe(this._messageChannel);
    instance.subscribe(this._closeChannel);

    instance.on('message', function(topic, message){
      if (topic === this._messageChannel) this.emptyQueue(message);
      if (topic === this._closeChannel)   this._server.trigger('close', message);
    }.bind(this));
  }.bind(this));

  this._gc = setInterval(function() { this.gc() }.bind(this), gc * 1000);
};

Engine.create = function(server, options) {
  return new this(server, options);
};

Engine.prototype = {
  DEFAULT_GC:       60,
  LOCK_TIMEOUT:     120,

  disconnect: function() {
    this._normalCluster.each(function(instance){
      instance.end();
    });

    this._subscriberCluster.each(function(instance){
      instance.unsubscribe();
      instance.end();
    });

    clearInterval(this._gc);
  },

  _key: function(key) {
    return this._ns + key;
  },

  _clientsKey: function() {
    return this._key('/clients');
  },

  _clientChannelsKey: function(clientId) {
    return this._key('/clients/' + clientId + '/channels');
  },

  _clientMessagesKey: function(clientId) {
    return this._key('/clients/' + clientId + '/messages');
  },

  _channelKey: function(channel) {
    return this._key('/channels' + channel);
  },

  createClient: function(callback, context) {
    var clientId = this._server.generateId()
      , instance = this._normalCluster.get('clients')

    instance.zadd(this._clientsKey(), 0, clientId, function(error, added){
      if (added === 0) return this.createClient(callback, context);

      this._server.debug('Created new client ?', clientId);
      this.ping(clientId);
      this._server.trigger('handshake', clientId);
      callback.call(context, clientId);
    }.bind(this));
  },

  clientExists: function(clientId, callback, context) {
    var cutoff = new Date().getTime() - (1000 * 1.6 * this._server.timeout)
      , instance = this._normalCluster.get('clients')

    instance.zscore(this._clientsKey(), clientId, function(error, score){
      callback.call(context, parseInt(score, 10) > cutoff);
    }.bind(this));
  },

  destroyClient: function(clientId, callback, context) {
    var _client = this._normalCluster.get(clientId, true)
      , _clients = this._normalCluster.get('clients', true)
      , tasks = []

    _client.smembers(this._clientChannelsKey(clientId)).then(function(channels){
      tasks.push(_clients.zadd(this._clientsKey(), 0, clientId));

      channels.forEach(function(channel) {
        tasks.push(_client.srem(this._clientChannelsKey(clientId), channel));

        var _channel = this._normalCluster.get(channel, true)
        tasks.push(_channel.srem(this._channelKey(channel), clientId));
      }.bind(this));

      tasks.push(_client.del(this._clientMessagesKey(clientId)));
      tasks.push(_clients.zrem(this._clientsKey(), clientId));
      tasks.push(_client.publish(this._closeChannel, clientId));

      return when.all(tasks).then(function(results){
        channels.forEach(function(channel, i) {
          if (results[2 * i + 1] !== 1) return;
          this._server.trigger('unsubscribe', clientId, channel);
          this._server.debug('Unsubscribed client ? from channel ?', clientId, channel);
        }.bind(this));

        this._server.debug('Destroyed client ?', clientId);
        this._server.trigger('disconnect', clientId);
      }.bind(this));

    }.bind(this)).catch(function(){

    }).finally(function(){
      if (callback) callback.call(context);
    });
  },

  ping: function(clientId) {
    var timeout = this._server.timeout;
    if (typeof timeout !== 'number') return;

    var time = new Date().getTime();

    this._server.debug('Ping ?, ?', clientId, time);

    var instance = this._normalCluster.get('clients');
    instance.zadd(this._clientsKey(), time, clientId);
  },

  subscribe: function(clientId, channel, callback, context) {
    var _client = this._normalCluster.get(clientId)
      , _channel = this._normalCluster.get(channel)

    _client.sadd(this._clientChannelsKey(clientId), channel, function(error, added){
      if (added === 1) this._server.trigger('subscribe', clientId, channel);
    }.bind(this));

    _channel.sadd(this._channelKey(channel), clientId, function(){
      this._server.debug('Subscribed client ? to channel ?', clientId, channel);
      if (callback) callback.call(context);
    }.bind(this));
  },

  unsubscribe: function(clientId, channel, callback, context) {
    var _client = this._normalCluster.get(clientId)
      , _channel = this._normalCluster.get(channel)

    _client.srem(this._clientChannelsKey(clientId), channel, function(error, removed){
      if (removed === 1) this._server.trigger('unsubscribe', clientId, channel);
    }.bind(this));

    _channel.srem(this._channelKey(channel), clientId, function(){
      this._server.debug('Unsubscribed client ? from channel ?', clientId, channel);
      if (callback) callback.call(context);
    }.bind(this));
  },

  publish: function(message, channels) {
    this._server.debug('Publishing message ?', message);

    var jsonMessage = JSON.stringify(message),
        keys        = channels.map(function(c) { return this._channelKey(c) }.bind(this));

    var notify = function(clients) {
      clients.forEach(function(clientId) {
        var queue = this._clientMessagesKey(clientId)
          , instance = this._normalCluster.get(clientId)

        this._server.debug('Queueing for client ?: ?', clientId, message);
        instance.rpush(queue, jsonMessage);
        instance.publish(this._messageChannel, clientId);

        this.clientExists(clientId, function(exists) {
          if (!exists) instance.del(queue);
        });
      }.bind(this));
    }.bind(this);

    var tasks = []
      , instances = {};

    _.each(channels, function(channel){
      var instance = this._normalCluster.get(channel, true);
      var config = instance._original.options;
      var key = [config.host, config.port].join(':');

      if (!instances[key]) {
        instances[key] = instance;  
      }
    }, this);

    _.each(instances, function(instance){
      tasks.push(instance.sunion.apply(instance, keys));
    }, true);

    when.all(tasks).then(function(results){
      results = _.chain(results).flatten().unique().value();
      notify(results);
    }).catch(function(){

    }).finally(function(){
       
    });
    
    this._server.trigger('publish', message.clientId, message.channel, message.data); 
  },

  emptyQueue: function(clientId) {
    if (!this._server.hasConnection(clientId)) return;
    var key = this._clientMessagesKey(clientId)
      , instance = this._normalCluster.get(clientId)
      , multi = instance.multi()

    multi.lrange(key, 0, -1, function(error, jsonMessages) {
      if (!jsonMessages) return;
      var messages = jsonMessages.map(function(json) { return JSON.parse(json) });
      this._server.deliver(clientId, messages);
    }.bind(this));

    multi.del(key);
    multi.exec();
  },

  gc: function() {
    var timeout = this._server.timeout;
    if (typeof timeout !== 'number') return;

    this._withLock('gc', function(releaseLock) {
      var cutoff = new Date().getTime() - 1000 * 2 * timeout,
          self   = this;

      var instance = this._normalCluster.get('clients');

      instance.zrangebyscore(this._clientsKey(), 0, cutoff, function(error, clients){
        var i = 0, n = clients.length;
        if (i === n) return releaseLock();

        clients.forEach(function(clientId) {
          this.destroyClient(clientId, function() {
            i += 1;
            if (i === n) releaseLock();
          }, this);
        }, self);
      });

    }, this);
  },

  _withLock: function(lockName, callback, context) {
    var lockKey     = this._ns + '/locks/' + lockName,
        currentTime = new Date().getTime(),
        expiry      = currentTime + this.LOCK_TIMEOUT * 1000 + 1,
        self        = this;

    var instance = this._normalCluster.get('locks');

    var releaseLock = function() {
      if (new Date().getTime() < expiry) instance.del(lockKey);
    };

    instance.setnx(lockKey, expiry, function(error, set) {
      if (set === 1) return callback.call(context, releaseLock);

      instance.get(lockKey, function(error, timeout) {
        if (!timeout) return;

        var lockTimeout = parseInt(timeout, 10);
        if (currentTime < lockTimeout) return;

        instance.getset(lockKey, expiry, function(error, oldValue) {
          if (oldValue !== timeout) return;
          callback.call(context, releaseLock);
        });
      });
    });
  }
};

module.exports = Engine;