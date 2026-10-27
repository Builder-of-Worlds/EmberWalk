import type { Failure } from "@emberwalk/db";

export const pass = <T>(value: T) => ({ ok: true, value }) as const;

export const refuse = (code: string, message: string) => ({ ok: false, failure: { code, message } satisfies Failure }) as const;

export type Outcome<T> = ReturnType<typeof pass<T>> | ReturnType<typeof refuse>;
