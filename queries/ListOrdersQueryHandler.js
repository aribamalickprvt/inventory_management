const orderReadModelRepository = require('../readmodel/OrderReadModelRepository');

class ListOrdersQueryHandler {
  async handle({ limit = 50 } = {}) {
    return orderReadModelRepository.findAll({ limit });
  }
}

module.exports = new ListOrdersQueryHandler();
