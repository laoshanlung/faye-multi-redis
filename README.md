# Faye Redis Engine
An implementation of Faye Engine for using with multiple redis server

# Example
```
var bayeux = new Faye.NodeAdapter({
  mount: '/faye'
  , timeout: 120
  , ping: 30
  , engine : {
    type:   require('faye-multi-redis-node'),
    cluster: [
      {
        "host": "127.0.0.1",
        "port": 6379,
        "password": "secret"
      },
      {
        "host": "127.0.0.1",
        "port": 6380,
        "password": "secret"
      },
      {
        "host": "127.0.0.1",
        "port": 6381,
        "password": "secret"
      }
    ]
  }
});
```

# Features
- Use multiple redis servers for storing faye clients/channels information
- Use multiple redis servers for pub/sub
- Automatically remove offline redis servers and add them back when they are online again (rely on [redis-spawn](https://github.com/laoshanlung/redis-spawn))

# TODOs
- Implement various custom filters for complete control over the flow of the engine
- Support redis socket

# License
MIT