var Promise = require('bluebird')

module.exports = function TransactionServiceFactory(socket) {
  var transactionService = {}

  function createChannel() {
    return 'tx' + Date.now() // @todo UUID
  }

  function Transaction(devices) {
    var pending = Object.create(null)
      , results = []
      , channel = createChannel()
      , resolver = Promise.defer()

    function doneListener(someChannel, data) {
      if (someChannel === channel) {
        pending[data.serial].done(data)
      }
    }

    function progressListener(someChannel, data) {
      if (someChannel === channel) {
        pending[data.serial].progress(data)
      }
    }

    socket.on('tx.done', doneListener)
    socket.on('tx.progress', progressListener)

    this.channel = channel
    this.results = results
    this.promise = Promise.settle(devices.map(function(device) {
        var pendingResult = new PendingTransactionResult(device)
        pending[device.serial] = pendingResult
        results.push(pendingResult.result)
        return pendingResult.promise
      }))
      .finally(function() {
        socket.removeListener('tx.done', doneListener)
        socket.removeListener('tx.progress', progressListener)
        socket.emit('tx.cleanup', channel)
      })
      .progressed(function() {
        return results
      })
      .then(function() {
        return results
      })
  }

  function PendingTransactionResult(device) {
    var resolver = Promise.defer()
      , result = new TransactionResult(device)
      , seq = 0
      , last = null
      , error = null
      , unplaced = []

    resolver.promise.finally(function() {
      result.settled = true
    })

    function readQueue() {
      var message
        , foundAny = false

      while (message = unplaced[seq]) {
        unplaced[seq] = void 0

        if (seq === last) {
          result.success = message.success

          if (message.success) {
            if (message.data) {
              result.data[seq] = message.data
            }
          }
          else {
            result.error = message.data
          }

          resolver.resolve(result)
          return
        }

        foundAny = true
        result.data[seq++] = message.data
      }

      if (foundAny) {
        resolver.progress(result)
      }
    }

    this.progress = function(message) {
      unplaced[message.seq] = message
      readQueue()
    }

    this.done = function(message) {
      last = message.seq
      unplaced[message.seq] = message
      readQueue()
    }

    this.result = result
    this.promise = resolver.promise
  }

  function TransactionResult(device) {
    this.device = device
    this.settled = false
    this.success = false
    this.error = null
    this.data = []
  }

  transactionService.create = function(devices) {
    return new Transaction(devices)
  }

  return transactionService
}
