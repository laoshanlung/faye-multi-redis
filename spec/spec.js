var RedisEngine = require('..')
var RedisSpawn = require('redis-spawn')

var cluster  = [
  {
    host: "127.0.0.1",
    port: 6500,
    password: "vagrant"
  },
  {
    host: "127.0.0.1",
    port: 6501,
    password: "vagrant"
  }
]

var _cluster = new RedisSpawn(cluster);

JS.Test.describe("Redis engine", function() { with(this) {
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
