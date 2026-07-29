class Money {
  constructor(amountInCents, currency = 'USD') {
    if (!Number.isInteger(amountInCents)) {
      throw new Error('Money amount must be an integer (cents)');
    }
    this.amountInCents = amountInCents;
    this.currency = currency;
    Object.freeze(this);
  }

  static zero(currency = 'USD') {
    return new Money(0, currency);
  }

  static fromDollars(dollars, currency = 'USD') {
    return new Money(Math.round(dollars * 100), currency);
  }

  add(other) {
    this._assertSameCurrency(other);
    return new Money(this.amountInCents + other.amountInCents, this.currency);
  }

  multiply(factor) {
    return new Money(Math.round(this.amountInCents * factor), this.currency);
  }

  equals(other) {
    return this.amountInCents === other.amountInCents && this.currency === other.currency;
  }

  toString() {
    return `${(this.amountInCents / 100).toFixed(2)} ${this.currency}`;
  }

  _assertSameCurrency(other) {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }
}

module.exports = Money;
