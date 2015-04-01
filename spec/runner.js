JS = require('jstest')

Faye = require('../vendor/faye/build/node/faye-node')
require('../vendor/faye/spec/javascript/engine_spec')
require('./spec')

JS.Test.autorun()