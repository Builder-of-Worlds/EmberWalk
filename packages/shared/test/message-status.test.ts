import { describe, expect, it } from "vitest";
import { MessageStatus } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("MessageStatus", () => {
  it("round trips the five states of an outgoing message and no other", () => {
    for (const status of ["draft", "approved", "sent", "sent_by_phone", "replied"]) roundTrips(MessageStatus, status);
    expect(MessageStatus.options).toEqual(["draft", "approved", "sent", "sent_by_phone", "replied"]);
  });

  it("refuses any other state", () => {
    for (const value of ["failed", "Draft", "sent by phone", "", null]) refuses(MessageStatus, value);
  });
});
