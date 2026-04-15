export class Calculator {
  private value = 0;
  add(n: number): this { this.value += n; return this; }
  subtract(n: number): this { this.value -= n; return this; }
  multiply(n: number): this { this.value *= n; return this; }
  divide(n: number): this {
    if (n === 0) throw new Error('Division by zero');
    this.value /= n;
    return this;
  }
  get result(): number { return this.value; }
}
