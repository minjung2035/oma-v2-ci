import { readFileSync } from "node:fs";
import { decodeSubject, parseEmlHeaders } from "../../mail/headers.js";
import { parseMessageId } from "../../ids.js";
import { fail } from "../exit.js";

export interface ReplyEffects {
  replyToMessage: string;
  inheritedSubject?: string;
}

/** Read and validate a reply source without mixing filesystem/header work into command orchestration. */
export function prepareReplyEffects(path: string, inheritSubject: boolean): ReplyEffects {
  let id: string | undefined;
  let inheritedSubject: string | undefined;
  try {
    const source = readFileSync(path);
    const headers = parseEmlHeaders(source, { maxHeaderBytes: source.byteLength });
    id = headers.messageId?.split("@", 1)[0];
    if (inheritSubject) inheritedSubject = `Re: ${decodeSubject(headers.subject)}`;
  } catch {
    fail("reply file has invalid OMA headers", 2);
  }
  if (!id || !parseMessageId(id)) fail("reply file has no valid Message-ID", 2);
  return inheritedSubject === undefined
    ? { replyToMessage: id }
    : { replyToMessage: id, inheritedSubject };
}
