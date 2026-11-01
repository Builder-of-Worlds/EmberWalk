export interface Entity {
  productName: string;
  sellerLine: string;
  legalName: string;
  supportEmail: string;
  copyrightLine: string;
  stateOfFormation: string;
  formed: string;
}

export const ENTITY: Readonly<Entity> = Object.freeze({
  productName: "EmberWalk",
  sellerLine: "EmberWalk is a product of The Arbiter Bibendi LLC.",
  legalName: "The Arbiter Bibendi LLC",
  supportEmail: "hello@emberwalk.app",
  copyrightLine: "© 2026 The Arbiter Bibendi LLC",
  stateOfFormation: "Nevada",
  formed: "December 2023",
});
