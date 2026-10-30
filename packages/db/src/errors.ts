export class DbRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbRefused";
  }
}

export class CapReached extends DbRefused {
  constructor(message: string) {
    super(message);
    this.name = "CapReached";
  }
}
