var RedisEngine = require('..')
var RedisSpawn = require('redis-spawn')

try {
  var cluster  = require('./servers.json')  
} catch (e) {
  throw "Must specify servers in servers.json file"
}

var _cluster = new RedisSpawn(cluster);

JS.Test.describe("Multi-Redis engine", function() { with(this) {
  before(function() {
    var pw = process.env.TRAVIS ? undefined : "foobared"
    this.engineOpts = {type: RedisEngine, cluster: cluster, namespace: new Date().getTime().toString()}
  })

  after(function(resume) { with(this) {
    disconnect_engine()
    _cluster.each(function(instance){
      instance.flushall(function(){
        instance.end();
      });
    });

    setTimeout(function(){
      resume();
    }.bind(this), 300);
  }})

  itShouldBehaveLike("faye engine")

  describe("distribution", function() { with(this) {
    itShouldBehaveLike("distributed engine")
  }})

  // if (process.env.TRAVIS) return

  // describe("using a Unix socket", function() { with(this) {
  //   before(function() { with(this) {
  //     this.engineOpts.socket = "/tmp/redis.sock"
  //   }})

  //   itShouldBehaveLike("faye engine")
  // }})
}})
