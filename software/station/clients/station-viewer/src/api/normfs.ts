/*
	          .'\   /`.
	         .'.-.`-'.-.`.
	    ..._:   .-. .-.   :_...
	  .'    '-.(o ) (o ).-'    `.
	 :  _    _ _`~(_)~`_ _    _  :
	:  /:   ' .-=_   _=-. `   ;\  :
	:   :|-.._  '     `  _..-|:   :
	 :   `:| |`:-:-.-:-:'| |:'   :
	  `.   `.| | | | | | |.'   .'
	    `.   `-:_| | |_:-'   .'
	      `-._   ````    _.-'
	          ``-------''

*/

import { normfs } from "./proto.js";
import webSocketManager from "./websocket.js";
import Long from "long";

function longToNumber(val: number | Long | null | undefined): number {
    if (val == null) {
        return 0;
    }
    if (typeof val === 'number') {
        return val;
    }
    return val.toNumber();
}

const SETUP_RESPONSE_TIMEOUT = 10000;
const CLIENT_VERSION = 1;
const REQUEST_TIMEOUT = 30000; // 30 seconds

export const ErrNotConnected = new Error("client not connected or setup not complete");
export const ErrBufferFull = new Error("client request buffer is full");
export const ErrRequestTimeout = new Error("request timed out waiting for server response");
export const ErrConnectionClosed = new Error("connection closed while waiting for response");
export const ErrInvalidResponse = new Error("invalid or unexpected response from server");
export const ErrServerSide = new Error("server returned an error");
export const ErrQueueNotFound = new Error("queue not found on server");
export const ErrEntryNotFound = new Error("Entry not found");
export const ErrReadStreamClosed = new Error("read stream closed by server or connection error");

export interface StreamEntry {
    id: Uint8Array;
    data: Uint8Array;
}

// Define interfaces for pending requests
interface PendingRequest<T> {
    resolve: (value: T) => void;
    reject: (reason?: any) => void;
    timeout: NodeJS.Timeout;
}

interface PendingStreamRequest {
    emitter: EventTarget;
    timeout: NodeJS.Timeout;
}

export class NormFsClient extends EventTarget {
    private nextWriteId = 1;
    private pendingWrites = new Map<number, PendingRequest<normfs.IWriteResponse>>();

    private nextReadId = 1;
    private pendingReads = new Map<number, PendingStreamRequest>();

    constructor() {
        super();
    }

    public onOpen() {
        console.log("NormFsClient: WebSocket connection opened. Performing setup...");
        this.performInitialSetup().catch(err => {
            console.error("NormFsClient: Initial setup failed", err);
        });
    }

    public onClose() {
        console.log("NormFsClient: WebSocket connection closed.");
        const err = new Error("Connection closed");
        this.failAllPending(err);
    }
    
    private failAllPending(err: Error) {
        for (const [id, req] of this.pendingWrites.entries()) {
            clearTimeout(req.timeout);
            req.reject(err);
            this.pendingWrites.delete(id);
        }
        for (const [id, req] of this.pendingReads.entries()) {
            clearTimeout(req.timeout);
            req.emitter.dispatchEvent(new CustomEvent('error', { detail: err }));
            this.pendingReads.delete(id);
        }
    }

    public processStreamFsResponse(response: normfs.ServerResponse) {
        if (response.setup) {
            this.dispatchEvent(new CustomEvent('__setup_response', { detail: response.setup }));
        } else if (response.ping) {
            // Pong, not used
        } else if (response.write && response.write.writeId) {
            const writeId = longToNumber(response.write.writeId);
            const req = this.pendingWrites.get(writeId);
            if (req) {
                clearTimeout(req.timeout);
                this.pendingWrites.delete(writeId);
                req.resolve(response.write);
            }
        } else if (response.read) {
            const readId = longToNumber(response.read.readId);
            const stream = this.pendingReads.get(readId);
            if (stream) {
                // Check for any terminal result to end the stream
                switch(response.read.result) {
                    case normfs.ReadResponse.Result.RR_START:
                        // This is just a notification, ignore it.
                        break;
                    case normfs.ReadResponse.Result.RR_END:
                        clearTimeout(stream.timeout);
                        stream.emitter.dispatchEvent(new Event('end'));
                        this.pendingReads.delete(readId);
                        break;
                    case normfs.ReadResponse.Result.RR_QUEUE_NOT_FOUND:
                        clearTimeout(stream.timeout);
                        stream.emitter.dispatchEvent(new CustomEvent('error', { detail: ErrQueueNotFound }));
                        this.pendingReads.delete(readId);
                        break;
                    case normfs.ReadResponse.Result.RR_NOT_FOUND:
                        clearTimeout(stream.timeout);
                        stream.emitter.dispatchEvent(new CustomEvent('error', { detail: ErrEntryNotFound }));
                        this.pendingReads.delete(readId);
                        break;
                    case normfs.ReadResponse.Result.RR_SERVER_ERROR:
                        clearTimeout(stream.timeout);
                        stream.emitter.dispatchEvent(new CustomEvent('error', { detail: ErrServerSide }));
                        this.pendingReads.delete(readId);
                        break;
                    default:
                        // This is a data packet
                        stream.emitter.dispatchEvent(new CustomEvent('data', { detail: response.read }));
                        break;
                }
            }
        }
    }

    public send(request: normfs.IClientRequest) {
        webSocketManager.send(request);
    }

    private async performInitialSetup(): Promise<void> {
        return new Promise((resolve, reject) => {
            const setupReq: normfs.IClientRequest = {
                setup: { version: Long.fromNumber(CLIENT_VERSION) }
            };

            const timeout = setTimeout(() => {
                this.removeEventListener('__setup_response', onSetupResponse);
                reject(new Error("Setup response timeout"));
            }, SETUP_RESPONSE_TIMEOUT);

            const onSetupResponse = (event: Event) => {
                const response = (event as CustomEvent).detail as normfs.ISetupResponse;
                clearTimeout(timeout);
                const serverVersion = longToNumber(response.version);
                if (serverVersion !== CLIENT_VERSION) {
                    return reject(new Error(`Version mismatch. Client: ${CLIENT_VERSION}, Server: ${serverVersion}`));
                }
                console.log("NormFsClient: Setup successful.");
                resolve();
            };

            this.addEventListener('__setup_response', onSetupResponse, { once: true });
            this.send(setupReq);
        });
    }

    // --- Public API ---
    
    public async enqueue(queueID: string, data: Uint8Array): Promise<Uint8Array> {
        const response = await this.enqueuePack(queueID, [data]);
        return response[0];
    }

    public async enqueuePack(queueID: string, data: Uint8Array[]): Promise<Uint8Array[]> {
        if (data.length === 0) {
            return Promise.resolve([]);
        }

        const writeId = this.nextWriteId++;
        const request: normfs.IClientRequest = {
            write: {
                writeId: Long.fromNumber(writeId),
                queueId: queueID,
                packets: data,
            },
        };

        return new Promise<Uint8Array[]>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingWrites.delete(writeId);
                reject(ErrRequestTimeout);
            }, REQUEST_TIMEOUT);

            this.pendingWrites.set(writeId, {
                resolve: (response) => {
                    switch (response.result) {
                        case normfs.WriteResponse.Result.WR_DONE:
                            resolve(response.ids?.map(id => id.raw as Uint8Array) || []);
                            break;
                        case normfs.WriteResponse.Result.WR_SERVER_ERROR:
                            reject(ErrServerSide);
                            break;
                        default:
                            reject(new Error(`Unexpected response from server: ${response.result}`));
                    }
                },
                reject,
                timeout
            });

            this.send(request);
        });
    }

    public read(queueID: string, offset: Uint8Array, offsetType: normfs.OffsetType, limit: number, step: number = 1): EventTarget {
        const emitter = new EventTarget();

        const readId = this.nextReadId++;
        const request: normfs.IClientRequest = {
            read: {
                readId: Long.fromNumber(readId),
                queueId: queueID,
                offset: { id: { raw: offset }, type: offsetType },
                limit: Long.fromNumber(limit),
                step: Long.fromNumber(step),
            },
        };

        const timeout = setTimeout(() => {
            this.pendingReads.delete(readId);
            emitter.dispatchEvent(new CustomEvent('error', { detail: ErrRequestTimeout }));
        }, REQUEST_TIMEOUT);

        this.pendingReads.set(readId, { emitter, timeout });
        this.send(request);

        return emitter;
    }

    public readSingleEntry(queueID: string, entryId: Uint8Array): Promise<StreamEntry> {
        return new Promise((resolve, reject) => {
            const stream = this.read(queueID, entryId, normfs.OffsetType.OT_ABSOLUTE, 1);
            let dataReceived = false;
    
            const onData = (event: Event) => {
                dataReceived = true;
                const readResponse = (event as CustomEvent).detail as normfs.IReadResponse;
                if (readResponse.data && readResponse.id?.raw) {
                    resolve({
                        id: readResponse.id.raw as Uint8Array,
                        data: readResponse.data,
                    });
                } else {
                    console.warn("NormFsClient: Invalid response for ReadSingleEntry request", readResponse);
                    reject(ErrInvalidResponse);
                }
                cleanup();
            };
    
            const onError = (event: Event) => {
                reject((event as CustomEvent).detail);
                cleanup();
            };
    
            const onEnd = () => {
                if (!dataReceived) {
                    reject(ErrEntryNotFound);
                }
                cleanup();
            };
    
            const cleanup = () => {
                stream.removeEventListener('data', onData);
                stream.removeEventListener('error', onError);
                stream.removeEventListener('end', onEnd);
            };
    
            stream.addEventListener('data', onData, { once: true });
            stream.addEventListener('error', onError, { once: true });
            stream.addEventListener('end', onEnd, { once: true });
        });
    }

    public readLastEntry(queueID: string): Promise<StreamEntry> {
        return new Promise((resolve, reject) => {
            // NormFS computes last_id - offset. Zero reads the actual tail;
            // one can miss immediately after older entries leave memory.
            const offset = Long.ZERO.toBytesLE();
            const stream = this.read(queueID, new Uint8Array(offset), normfs.OffsetType.OT_SHIFT_FROM_TAIL, 1);
            let dataReceived = false;

            const onData = (event: Event) => {
                dataReceived = true;
                const readResponse = (event as CustomEvent).detail as normfs.IReadResponse;
                if (readResponse.data && readResponse.id?.raw) {
                    resolve({
                        id: readResponse.id.raw as Uint8Array,
                        data: readResponse.data,
                    });
                } else {
                    reject(ErrInvalidResponse);
                }
                cleanup();
            };

            const onError = (event: Event) => {
                reject((event as CustomEvent).detail);
                cleanup();
            };

            const onEnd = () => {
                if (!dataReceived) {
                    reject(new Error("Queue empty"));
                }
                cleanup();
            };

            const cleanup = () => {
                stream.removeEventListener('data', onData);
                stream.removeEventListener('error', onError);
                stream.removeEventListener('end', onEnd);
            };

            stream.addEventListener('data', onData, { once: true });
            stream.addEventListener('error', onError, { once: true });
            stream.addEventListener('end', onEnd, { once: true });
        });
    }
}
