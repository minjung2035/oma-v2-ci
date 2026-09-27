import { decodeSubject, parseEmlHeaders } from "../../mail/headers.js";
import { parseMessageId } from "../../ids.js";
import { fail } from "../exit.js";
import { readLocalHead } from "../effects.js";
import { MAIL_HEADER_BYTES } from "../../domain/mail-values.js";

export interface ReplyEffects {
  replyToMessage: string;
  inheritedSubject?: string;
}

/** Read and validate a reply source without mixing filesystem/header work into command orchestration. */
export function prepareReplyEffects(path: string, inheritSubject: boolean): ReplyEffects {
  let id: string | undefined;
  let inheritedSubject: string | undefined;
  // P0V-63: the stored message's headers, within the budget every stored
  // message's headers keep (`headerBlock` looks for their end four bytes past
  // it); its body, however large, is neither read nor needed.
  const source = readLocalHead(path, MAIL_HEADER_BYTES + 4);
  try {
    const headers = parseEmlHeaders(source, { maxHeaderBytes: MAIL_HEADER_BYTES });
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
