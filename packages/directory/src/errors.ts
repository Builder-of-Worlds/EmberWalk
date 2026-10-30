export class DirectoryRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectoryRefused";
  }
}

export class UnknownZip extends DirectoryRefused {
  constructor(zip: string) {
    super(`no centre point is held for ZIP ${zip}`);
    this.name = "UnknownZip";
  }
}
