/** PR-001: the Principal session's endpoint, and the only thing that decides
 * who the Principal is.
 *
 * A Resident is authorised by the systemd scope it runs in. The Principal has
 * none — the product starts its engine itself, in the Human's terminal — so
 * this stands in for that scope: a secret minted for this broker run and
 * handed to the host that registered the session, and the handle that host
 * named before the broker existed. Neither alone is enough, and neither is
 * recorded from whoever arrives first.
 *
 * It lives apart from the broker because it is a distinct authority decision,
 * not another line in the broker's dispatch. The broker owns the sockets and
 * the connection machinery, which reach here as ports; nothing in this file
 * reads a store, a unit or a file.
 */
import { randomBytes } from "node:crypto";
import type { Socket } from "node:net";
import type { AuthContext, Request } from "../../implementation/contracts.js";
import { StoreError, publicFailure } from "../domain/errors.js";
import { INTERNAL_METHODS } from "../protocol/methods.js";
import { PRINCIPAL_CREDENTIAL_HEX, credentialMatches, isPrincipalSessionHandle, sessionHandleMatches } from "../protocol/principal-credential.js";
import { okAnswer } from "./replies.js";
import type { BoundPeer } from "./peer-authenticator.js";

/** The session a host registered before this broker started. `publish` is that
 * host's own channel; it is called once the endpoint is listening, so a host
 * holding the credential can rely on the endpoint being there. */
export interface PrincipalSessionRegistration {
  readonly sessionHandle: string;
  readonly publish: (credential: string) => void;
}

export interface PrincipalEndpointPorts {
  readonly isDraining: () => boolean;
  readonly bindPeer: (socket: Socket) => BoundPeer | null;
  /** The live authority of the `principal` row, re-derived on every read. */
  readonly principalContext: (peer: BoundPeer) => AuthContext | null;
  readonly serveFrames: (
    socket: Socket,
    peer: BoundPeer,
    handle: (raw: Record<string, unknown>, stream: AsyncIterable<Uint8Array> | null) => Promise<object>,
    preflight: (raw: Record<string, unknown>) => void,
  ) => void;
  readonly dispatch: (auth: AuthContext, request: Request, stream: AsyncIterable<Uint8Array> | null) => Promise<object>;
  readonly preflight: (auth: AuthContext, raw: Record<string, unknown>) => void;
  readonly fail: (socket: Socket, failure: ReturnType<typeof publicFailure>) => void;
  readonly observe: (error: unknown) => void;
  readonly cleanupError: (error: unknown) => void;
}

export class PrincipalEndpoint {
  /** Minted per run and written nowhere. A copy taken from an earlier run names
   * a secret this broker never had. */
  private readonly secret = randomBytes(PRINCIPAL_CREDENTIAL_HEX / 2).toString("hex");
  private open = true;

  constructor(
    private readonly registration: PrincipalSessionRegistration,
    private readonly ports: PrincipalEndpointPorts,
  ) {
    if (!isPrincipalSessionHandle(registration.sessionHandle))
      throw new StoreError("UNSUPPORTED_PROFILE", "the registered principal session handle is malformed");
  }

  /** Called once the endpoint is listening, never before. */
  publish(): void { if (this.open) this.registration.publish(this.secret); }

  /** The credential stops existing with the broker that minted it. */
  close(): void { this.open = false; }

  /** A connection is nobody until it attaches, and every request before that is
   * refused. Attaching is the ordinary first frame of the connection, so the
   * endpoint adds no separate channel for it. */
  serve(socket: Socket): void {
    let peer: BoundPeer | null = null;
    let transferred = false;
    try {
      if (this.ports.isDraining() || !this.open) throw new StoreError("BROKER_UNAVAILABLE", "broker is draining");
      peer = this.ports.bindPeer(socket);
      if (!peer || peer.uid !== (process.getuid?.() ?? -1))
        throw new StoreError("AUTH_FAILED", "invalid principal peer credentials");
      const credentials = peer;
      let auth: AuthContext | null = null;
      this.ports.serveFrames(socket, peer, async (raw, stream) => {
        if (auth === null) {
          const attached = this.attach(raw, credentials);
          auth = attached.auth;
          return attached.answer;
        }
        if (raw.method === "principal.detach") {
          auth = null;
          return okAnswer(typeof raw.id === "string" ? raw.id : "x", {});
        }
        return this.ports.dispatch(auth, raw as Request, stream);
      }, raw => {
        if (auth === null) throw new StoreError("AUTH_FAILED", "the principal session is not attached");
        this.ports.preflight(auth, raw);
      });
      transferred = true;
    } catch (error) {
      this.ports.observe(error);
      this.ports.fail(socket, publicFailure(error));
    } finally {
      if (!transferred) {
        try { peer?.releaseConnection(); } catch (error) { this.ports.cleanupError(error); }
      }
    }
  }

  /** The attach frame. Its shape and parameters come from the protocol
   * registry, so this cannot drift from the declared contract. */
  private attach(raw: Record<string, unknown>, peer: BoundPeer): { auth: AuthContext; answer: object } {
    const id = typeof raw.id === "string" ? raw.id : "x";
    if (raw.method !== "principal.attach")
      throw new StoreError("AUTH_FAILED", "the principal session must attach before any other request");
    if (INTERNAL_METHODS["principal.attach"].paramsCheck(raw.params) !== null)
      throw new StoreError("INVALID_REQUEST", "invalid principal attach parameters");
    const params = raw.params as { sessionHandle: string; credential: string };
    if (!this.open || !credentialMatches(params.credential, this.secret))
      throw new StoreError("AUTH_FAILED", "principal attach credential is not this broker's");
    // The society has one Principal, and which one was decided by the host
    // before this broker started. A caller naming another session is a
    // conflict, not a failed authentication: the two recover differently.
    if (!sessionHandleMatches(params.sessionHandle, this.registration.sessionHandle))
      throw new StoreError("ATTACH_CONFLICT", "another principal session owns this society");
    const auth = this.ports.principalContext(peer);
    if (!auth) throw new StoreError("AUTH_FAILED", "no live principal to attach to");
    return { auth, answer: okAnswer(id, { actor: "principal", incarnation: auth.incarnation }) };
  }
}
