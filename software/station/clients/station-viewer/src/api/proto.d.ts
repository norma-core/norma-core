import * as $protobuf from "protobufjs";
import Long = require("long");
/** Namespace commands. */
export namespace commands {

    /** Properties of a DriverCommand. */
    interface IDriverCommand {

        /** DriverCommand commandId */
        commandId?: (Uint8Array|null);

        /** DriverCommand type */
        type?: (drivers.StationCommandType|null);

        /** DriverCommand body */
        body?: (Uint8Array|null);
    }

    /** Represents a DriverCommand. */
    class DriverCommand implements IDriverCommand {

        /**
         * Constructs a new DriverCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: commands.IDriverCommand);

        /** DriverCommand commandId. */
        public commandId: Uint8Array;

        /** DriverCommand type. */
        public type: drivers.StationCommandType;

        /** DriverCommand body. */
        public body: Uint8Array;

        /**
         * Creates a new DriverCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns DriverCommand instance
         */
        public static create(properties?: commands.IDriverCommand): commands.DriverCommand;

        /**
         * Encodes the specified DriverCommand message. Does not implicitly {@link commands.DriverCommand.verify|verify} messages.
         * @param message DriverCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: commands.IDriverCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified DriverCommand message, length delimited. Does not implicitly {@link commands.DriverCommand.verify|verify} messages.
         * @param message DriverCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: commands.IDriverCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a DriverCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns DriverCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): commands.DriverCommand;

        /**
         * Decodes a DriverCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns DriverCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): commands.DriverCommand;

        /**
         * Verifies a DriverCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a DriverCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns DriverCommand
         */
        public static fromObject(object: { [k: string]: any }): commands.DriverCommand;

        /**
         * Creates a plain object from a DriverCommand message. Also converts values to other types if specified.
         * @param message DriverCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: commands.DriverCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this DriverCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for DriverCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a StationCommandsPack. */
    interface IStationCommandsPack {

        /** StationCommandsPack inferenceStateId */
        inferenceStateId?: (Uint8Array|null);

        /** StationCommandsPack packId */
        packId?: (Uint8Array|null);

        /** StationCommandsPack commands */
        commands?: (commands.IDriverCommand[]|null);

        /** StationCommandsPack tags */
        tags?: (string[]|null);
    }

    /** Represents a StationCommandsPack. */
    class StationCommandsPack implements IStationCommandsPack {

        /**
         * Constructs a new StationCommandsPack.
         * @param [properties] Properties to set
         */
        constructor(properties?: commands.IStationCommandsPack);

        /** StationCommandsPack inferenceStateId. */
        public inferenceStateId: Uint8Array;

        /** StationCommandsPack packId. */
        public packId: Uint8Array;

        /** StationCommandsPack commands. */
        public commands: commands.IDriverCommand[];

        /** StationCommandsPack tags. */
        public tags: string[];

        /**
         * Creates a new StationCommandsPack instance using the specified properties.
         * @param [properties] Properties to set
         * @returns StationCommandsPack instance
         */
        public static create(properties?: commands.IStationCommandsPack): commands.StationCommandsPack;

        /**
         * Encodes the specified StationCommandsPack message. Does not implicitly {@link commands.StationCommandsPack.verify|verify} messages.
         * @param message StationCommandsPack message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: commands.IStationCommandsPack, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified StationCommandsPack message, length delimited. Does not implicitly {@link commands.StationCommandsPack.verify|verify} messages.
         * @param message StationCommandsPack message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: commands.IStationCommandsPack, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a StationCommandsPack message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns StationCommandsPack
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): commands.StationCommandsPack;

        /**
         * Decodes a StationCommandsPack message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns StationCommandsPack
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): commands.StationCommandsPack;

        /**
         * Verifies a StationCommandsPack message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a StationCommandsPack message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns StationCommandsPack
         */
        public static fromObject(object: { [k: string]: any }): commands.StationCommandsPack;

        /**
         * Creates a plain object from a StationCommandsPack message. Also converts values to other types if specified.
         * @param message StationCommandsPack
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: commands.StationCommandsPack, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this StationCommandsPack to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for StationCommandsPack
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }
}

/** Namespace drivers. */
export namespace drivers {

    /** QueueDataType enum. */
    enum QueueDataType {
        QDT_SYSTEM = 0,
        QDT_STATION_COMMANDS = 1,
        QDT_STATION_STARTUPS = 2,
        QDT_INFERENCE_TAGS_RX = 3,
        QDT_ST3215_SERIAL_TX = 10,
        QDT_ST3215_SERIAL_RX = 11,
        QDT_ST3215_META = 12,
        QDT_ST3215_INFERENCE = 13,
        QDT_FFMPEG_VIDEO_STREAM_RX = 20,
        QDT_USB_VIDEO_FRAMES = 21,
        QDT_INFERENCE_FRAMES = 22,
        QDT_MOTOR_MIRRORING_MODES = 30,
        QDT_MOTOR_MIRRORING_RX = 32,
        QDT_MOTOR_MIRRORING_GRAVITY_COMP_MODES = 33,
        QDT_MOTOR_MIRRORING_GRAVITY_COMP_SETTINGS = 34,
        QDT_YAHBOOM_DOGZILLA_LITE_SERIAL_TX = 40,
        QDT_YAHBOOM_DOGZILLA_LITE_SERIAL_RX = 41,
        QDT_YAHBOOM_DOGZILLA_LITE_INFERENCE = 42
    }

    /** StationCommandType enum. */
    enum StationCommandType {
        STC_ST3215_COMMAND = 0,
        STC_MOTOR_MIRRORING_COMMAND = 1,
        STC_INFERENCE_TAG_COMMAND = 2,
        STC_YAHBOOM_DOGZILLA_LITE_COMMAND = 3,
        STC_GRAVITY_COMP_COMMAND = 4
    }
}

/** Namespace inference. */
export namespace inference {

    /** Properties of an InferenceRx. */
    interface IInferenceRx {

        /** InferenceRx localStampNs */
        localStampNs?: (Long|null);

        /** InferenceRx monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** InferenceRx appStartId */
        appStartId?: (Long|null);

        /** InferenceRx entries */
        entries?: (inference.InferenceRx.IEntry[]|null);
    }

    /** Represents an InferenceRx. */
    class InferenceRx implements IInferenceRx {

        /**
         * Constructs a new InferenceRx.
         * @param [properties] Properties to set
         */
        constructor(properties?: inference.IInferenceRx);

        /** InferenceRx localStampNs. */
        public localStampNs: Long;

        /** InferenceRx monotonicStampNs. */
        public monotonicStampNs: Long;

        /** InferenceRx appStartId. */
        public appStartId: Long;

        /** InferenceRx entries. */
        public entries: inference.InferenceRx.IEntry[];

        /**
         * Creates a new InferenceRx instance using the specified properties.
         * @param [properties] Properties to set
         * @returns InferenceRx instance
         */
        public static create(properties?: inference.IInferenceRx): inference.InferenceRx;

        /**
         * Encodes the specified InferenceRx message. Does not implicitly {@link inference.InferenceRx.verify|verify} messages.
         * @param message InferenceRx message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: inference.IInferenceRx, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified InferenceRx message, length delimited. Does not implicitly {@link inference.InferenceRx.verify|verify} messages.
         * @param message InferenceRx message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: inference.IInferenceRx, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an InferenceRx message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns InferenceRx
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): inference.InferenceRx;

        /**
         * Decodes an InferenceRx message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns InferenceRx
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): inference.InferenceRx;

        /**
         * Verifies an InferenceRx message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an InferenceRx message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns InferenceRx
         */
        public static fromObject(object: { [k: string]: any }): inference.InferenceRx;

        /**
         * Creates a plain object from an InferenceRx message. Also converts values to other types if specified.
         * @param message InferenceRx
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: inference.InferenceRx, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this InferenceRx to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for InferenceRx
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    namespace InferenceRx {

        /** Properties of an Entry. */
        interface IEntry {

            /** Entry queue */
            queue?: (string|null);

            /** Entry ptr */
            ptr?: (Uint8Array|null);

            /** Entry type */
            type?: (drivers.QueueDataType|null);
        }

        /** Represents an Entry. */
        class Entry implements IEntry {

            /**
             * Constructs a new Entry.
             * @param [properties] Properties to set
             */
            constructor(properties?: inference.InferenceRx.IEntry);

            /** Entry queue. */
            public queue: string;

            /** Entry ptr. */
            public ptr: Uint8Array;

            /** Entry type. */
            public type: drivers.QueueDataType;

            /**
             * Creates a new Entry instance using the specified properties.
             * @param [properties] Properties to set
             * @returns Entry instance
             */
            public static create(properties?: inference.InferenceRx.IEntry): inference.InferenceRx.Entry;

            /**
             * Encodes the specified Entry message. Does not implicitly {@link inference.InferenceRx.Entry.verify|verify} messages.
             * @param message Entry message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: inference.InferenceRx.IEntry, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified Entry message, length delimited. Does not implicitly {@link inference.InferenceRx.Entry.verify|verify} messages.
             * @param message Entry message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: inference.InferenceRx.IEntry, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes an Entry message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns Entry
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): inference.InferenceRx.Entry;

            /**
             * Decodes an Entry message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns Entry
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): inference.InferenceRx.Entry;

            /**
             * Verifies an Entry message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates an Entry message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns Entry
             */
            public static fromObject(object: { [k: string]: any }): inference.InferenceRx.Entry;

            /**
             * Creates a plain object from an Entry message. Also converts values to other types if specified.
             * @param message Entry
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: inference.InferenceRx.Entry, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this Entry to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for Entry
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }
    }
}

/** Namespace startups. */
export namespace startups {

    /** Properties of a StationStartup. */
    interface IStationStartup {

        /** StationStartup monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** StationStartup localStampNs */
        localStampNs?: (Long|null);

        /** StationStartup appStartId */
        appStartId?: (Long|null);

        /** StationStartup stationUuid */
        stationUuid?: (Uint8Array|null);

        /** StationStartup version */
        version?: (string|null);

        /** StationStartup gitHash */
        gitHash?: (string|null);

        /** StationStartup inferenceQueuePtr */
        inferenceQueuePtr?: (Uint8Array|null);
    }

    /** Represents a StationStartup. */
    class StationStartup implements IStationStartup {

        /**
         * Constructs a new StationStartup.
         * @param [properties] Properties to set
         */
        constructor(properties?: startups.IStationStartup);

        /** StationStartup monotonicStampNs. */
        public monotonicStampNs: Long;

        /** StationStartup localStampNs. */
        public localStampNs: Long;

        /** StationStartup appStartId. */
        public appStartId: Long;

        /** StationStartup stationUuid. */
        public stationUuid: Uint8Array;

        /** StationStartup version. */
        public version: string;

        /** StationStartup gitHash. */
        public gitHash: string;

        /** StationStartup inferenceQueuePtr. */
        public inferenceQueuePtr: Uint8Array;

        /**
         * Creates a new StationStartup instance using the specified properties.
         * @param [properties] Properties to set
         * @returns StationStartup instance
         */
        public static create(properties?: startups.IStationStartup): startups.StationStartup;

        /**
         * Encodes the specified StationStartup message. Does not implicitly {@link startups.StationStartup.verify|verify} messages.
         * @param message StationStartup message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: startups.IStationStartup, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified StationStartup message, length delimited. Does not implicitly {@link startups.StationStartup.verify|verify} messages.
         * @param message StationStartup message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: startups.IStationStartup, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a StationStartup message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns StationStartup
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): startups.StationStartup;

        /**
         * Decodes a StationStartup message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns StationStartup
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): startups.StationStartup;

        /**
         * Verifies a StationStartup message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a StationStartup message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns StationStartup
         */
        public static fromObject(object: { [k: string]: any }): startups.StationStartup;

        /**
         * Creates a plain object from a StationStartup message. Also converts values to other types if specified.
         * @param message StationStartup
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: startups.StationStartup, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this StationStartup to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for StationStartup
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }
}

/** Namespace inference_tags. */
export namespace inference_tags {

    /** CommandType enum. */
    enum CommandType {
        CT_ADD_TAG = 0,
        CT_REMOVE_TAG = 1
    }

    /** Properties of a RxEnvelope. */
    interface IRxEnvelope {

        /** RxEnvelope monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** RxEnvelope localStampNs */
        localStampNs?: (Long|null);

        /** RxEnvelope appStartId */
        appStartId?: (Long|null);

        /** RxEnvelope type */
        type?: (inference_tags.CommandType|null);

        /** RxEnvelope inferenceQueuePtr */
        inferenceQueuePtr?: (Uint8Array|null);

        /** RxEnvelope tag */
        tag?: (string|null);
    }

    /** Represents a RxEnvelope. */
    class RxEnvelope implements IRxEnvelope {

        /**
         * Constructs a new RxEnvelope.
         * @param [properties] Properties to set
         */
        constructor(properties?: inference_tags.IRxEnvelope);

        /** RxEnvelope monotonicStampNs. */
        public monotonicStampNs: Long;

        /** RxEnvelope localStampNs. */
        public localStampNs: Long;

        /** RxEnvelope appStartId. */
        public appStartId: Long;

        /** RxEnvelope type. */
        public type: inference_tags.CommandType;

        /** RxEnvelope inferenceQueuePtr. */
        public inferenceQueuePtr: Uint8Array;

        /** RxEnvelope tag. */
        public tag: string;

        /**
         * Creates a new RxEnvelope instance using the specified properties.
         * @param [properties] Properties to set
         * @returns RxEnvelope instance
         */
        public static create(properties?: inference_tags.IRxEnvelope): inference_tags.RxEnvelope;

        /**
         * Encodes the specified RxEnvelope message. Does not implicitly {@link inference_tags.RxEnvelope.verify|verify} messages.
         * @param message RxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: inference_tags.IRxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified RxEnvelope message, length delimited. Does not implicitly {@link inference_tags.RxEnvelope.verify|verify} messages.
         * @param message RxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: inference_tags.IRxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a RxEnvelope message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns RxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): inference_tags.RxEnvelope;

        /**
         * Decodes a RxEnvelope message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns RxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): inference_tags.RxEnvelope;

        /**
         * Verifies a RxEnvelope message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a RxEnvelope message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns RxEnvelope
         */
        public static fromObject(object: { [k: string]: any }): inference_tags.RxEnvelope;

        /**
         * Creates a plain object from a RxEnvelope message. Also converts values to other types if specified.
         * @param message RxEnvelope
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: inference_tags.RxEnvelope, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this RxEnvelope to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for RxEnvelope
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a Command. */
    interface ICommand {

        /** Command type */
        type?: (inference_tags.CommandType|null);

        /** Command inferenceQueuePtr */
        inferenceQueuePtr?: (Uint8Array|null);

        /** Command tag */
        tag?: (string|null);
    }

    /** Represents a Command. */
    class Command implements ICommand {

        /**
         * Constructs a new Command.
         * @param [properties] Properties to set
         */
        constructor(properties?: inference_tags.ICommand);

        /** Command type. */
        public type: inference_tags.CommandType;

        /** Command inferenceQueuePtr. */
        public inferenceQueuePtr: Uint8Array;

        /** Command tag. */
        public tag: string;

        /**
         * Creates a new Command instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Command instance
         */
        public static create(properties?: inference_tags.ICommand): inference_tags.Command;

        /**
         * Encodes the specified Command message. Does not implicitly {@link inference_tags.Command.verify|verify} messages.
         * @param message Command message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: inference_tags.ICommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Command message, length delimited. Does not implicitly {@link inference_tags.Command.verify|verify} messages.
         * @param message Command message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: inference_tags.ICommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Command message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Command
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): inference_tags.Command;

        /**
         * Decodes a Command message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Command
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): inference_tags.Command;

        /**
         * Verifies a Command message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Command message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Command
         */
        public static fromObject(object: { [k: string]: any }): inference_tags.Command;

        /**
         * Creates a plain object from a Command message. Also converts values to other types if specified.
         * @param message Command
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: inference_tags.Command, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Command to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Command
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }
}

/** Namespace st3215. */
export namespace st3215 {

    /** ST3215SignalType enum. */
    enum ST3215SignalType {
        ST3215_SIGNAL_TYPE_UNSPECIFIED = 0,
        ST3215_BUS_CONNECT = 1,
        ST3215_BUS_DISCONNECT = 2,
        ST3215_DRIVE_CONNECT = 3,
        ST3215_DRIVE_DISCONNECT = 4,
        ST3215_DRIVE_STATE = 6,
        ST3215_COMMAND = 7,
        ST3215_COMMAND_SUCCESS = 8,
        ST3215_ERROR = 9,
        ST3215_COMMAND_REJECTED = 11,
        ST3215_COMMAND_FAILED = 12
    }

    /** Properties of a RxEnvelope. */
    interface IRxEnvelope {

        /** RxEnvelope monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** RxEnvelope localStampNs */
        localStampNs?: (Long|null);

        /** RxEnvelope appStartId */
        appStartId?: (Long|null);

        /** RxEnvelope signalType */
        signalType?: (st3215.ST3215SignalType|null);

        /** RxEnvelope bus */
        bus?: (st3215.IST3215Bus|null);

        /** RxEnvelope motorId */
        motorId?: (number|null);

        /** RxEnvelope data */
        data?: (Uint8Array|null);

        /** RxEnvelope command */
        command?: (st3215.ITxEnvelope|null);

        /** RxEnvelope error */
        error?: (st3215.IST3215Error|null);
    }

    /** Represents a RxEnvelope. */
    class RxEnvelope implements IRxEnvelope {

        /**
         * Constructs a new RxEnvelope.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IRxEnvelope);

        /** RxEnvelope monotonicStampNs. */
        public monotonicStampNs: Long;

        /** RxEnvelope localStampNs. */
        public localStampNs: Long;

        /** RxEnvelope appStartId. */
        public appStartId: Long;

        /** RxEnvelope signalType. */
        public signalType: st3215.ST3215SignalType;

        /** RxEnvelope bus. */
        public bus?: (st3215.IST3215Bus|null);

        /** RxEnvelope motorId. */
        public motorId: number;

        /** RxEnvelope data. */
        public data: Uint8Array;

        /** RxEnvelope command. */
        public command?: (st3215.ITxEnvelope|null);

        /** RxEnvelope error. */
        public error?: (st3215.IST3215Error|null);

        /**
         * Creates a new RxEnvelope instance using the specified properties.
         * @param [properties] Properties to set
         * @returns RxEnvelope instance
         */
        public static create(properties?: st3215.IRxEnvelope): st3215.RxEnvelope;

        /**
         * Encodes the specified RxEnvelope message. Does not implicitly {@link st3215.RxEnvelope.verify|verify} messages.
         * @param message RxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IRxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified RxEnvelope message, length delimited. Does not implicitly {@link st3215.RxEnvelope.verify|verify} messages.
         * @param message RxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IRxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a RxEnvelope message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns RxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.RxEnvelope;

        /**
         * Decodes a RxEnvelope message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns RxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.RxEnvelope;

        /**
         * Verifies a RxEnvelope message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a RxEnvelope message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns RxEnvelope
         */
        public static fromObject(object: { [k: string]: any }): st3215.RxEnvelope;

        /**
         * Creates a plain object from a RxEnvelope message. Also converts values to other types if specified.
         * @param message RxEnvelope
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.RxEnvelope, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this RxEnvelope to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for RxEnvelope
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a TxEnvelope. */
    interface ITxEnvelope {

        /** TxEnvelope monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** TxEnvelope localStampNs */
        localStampNs?: (Long|null);

        /** TxEnvelope appStartId */
        appStartId?: (Long|null);

        /** TxEnvelope targetBusSerial */
        targetBusSerial?: (string|null);

        /** TxEnvelope commandId */
        commandId?: (Uint8Array|null);

        /** TxEnvelope write */
        write?: (st3215.IST3215WriteCommand|null);

        /** TxEnvelope regWrite */
        regWrite?: (st3215.IST3215RegWriteCommand|null);

        /** TxEnvelope action */
        action?: (st3215.IST3215ActionCommand|null);

        /** TxEnvelope reset */
        reset?: (st3215.IST3215ResetCommand|null);

        /** TxEnvelope resetCalibration */
        resetCalibration?: (st3215.IResetCalibrationCommand|null);

        /** TxEnvelope freezeCalibration */
        freezeCalibration?: (st3215.IFreezeCalibrationCommand|null);

        /** TxEnvelope syncWrite */
        syncWrite?: (st3215.IST3215SyncWriteCommand|null);

        /** TxEnvelope autoCalibrate */
        autoCalibrate?: (st3215.IAutoCalibrateCommand|null);

        /** TxEnvelope stopAutoCalibrate */
        stopAutoCalibrate?: (st3215.IStopAutoCalibrateCommand|null);
    }

    /** Represents a TxEnvelope. */
    class TxEnvelope implements ITxEnvelope {

        /**
         * Constructs a new TxEnvelope.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.ITxEnvelope);

        /** TxEnvelope monotonicStampNs. */
        public monotonicStampNs: Long;

        /** TxEnvelope localStampNs. */
        public localStampNs: Long;

        /** TxEnvelope appStartId. */
        public appStartId: Long;

        /** TxEnvelope targetBusSerial. */
        public targetBusSerial: string;

        /** TxEnvelope commandId. */
        public commandId: Uint8Array;

        /** TxEnvelope write. */
        public write?: (st3215.IST3215WriteCommand|null);

        /** TxEnvelope regWrite. */
        public regWrite?: (st3215.IST3215RegWriteCommand|null);

        /** TxEnvelope action. */
        public action?: (st3215.IST3215ActionCommand|null);

        /** TxEnvelope reset. */
        public reset?: (st3215.IST3215ResetCommand|null);

        /** TxEnvelope resetCalibration. */
        public resetCalibration?: (st3215.IResetCalibrationCommand|null);

        /** TxEnvelope freezeCalibration. */
        public freezeCalibration?: (st3215.IFreezeCalibrationCommand|null);

        /** TxEnvelope syncWrite. */
        public syncWrite?: (st3215.IST3215SyncWriteCommand|null);

        /** TxEnvelope autoCalibrate. */
        public autoCalibrate?: (st3215.IAutoCalibrateCommand|null);

        /** TxEnvelope stopAutoCalibrate. */
        public stopAutoCalibrate?: (st3215.IStopAutoCalibrateCommand|null);

        /**
         * Creates a new TxEnvelope instance using the specified properties.
         * @param [properties] Properties to set
         * @returns TxEnvelope instance
         */
        public static create(properties?: st3215.ITxEnvelope): st3215.TxEnvelope;

        /**
         * Encodes the specified TxEnvelope message. Does not implicitly {@link st3215.TxEnvelope.verify|verify} messages.
         * @param message TxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.ITxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified TxEnvelope message, length delimited. Does not implicitly {@link st3215.TxEnvelope.verify|verify} messages.
         * @param message TxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.ITxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a TxEnvelope message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns TxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.TxEnvelope;

        /**
         * Decodes a TxEnvelope message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns TxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.TxEnvelope;

        /**
         * Verifies a TxEnvelope message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a TxEnvelope message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns TxEnvelope
         */
        public static fromObject(object: { [k: string]: any }): st3215.TxEnvelope;

        /**
         * Creates a plain object from a TxEnvelope message. Also converts values to other types if specified.
         * @param message TxEnvelope
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.TxEnvelope, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this TxEnvelope to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for TxEnvelope
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a MetaEnvelope. */
    interface IMetaEnvelope {

        /** MetaEnvelope monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** MetaEnvelope localStampNs */
        localStampNs?: (Long|null);

        /** MetaEnvelope appStartId */
        appStartId?: (Long|null);

        /** MetaEnvelope type */
        type?: (st3215.MetaEnvelopeType|null);

        /** MetaEnvelope rxUintnPtr */
        rxUintnPtr?: (Uint8Array|null);

        /** MetaEnvelope busSerial */
        busSerial?: (string|null);

        /** MetaEnvelope arcs */
        arcs?: (st3215.IMotorArc[]|null);
    }

    /** Represents a MetaEnvelope. */
    class MetaEnvelope implements IMetaEnvelope {

        /**
         * Constructs a new MetaEnvelope.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IMetaEnvelope);

        /** MetaEnvelope monotonicStampNs. */
        public monotonicStampNs: Long;

        /** MetaEnvelope localStampNs. */
        public localStampNs: Long;

        /** MetaEnvelope appStartId. */
        public appStartId: Long;

        /** MetaEnvelope type. */
        public type: st3215.MetaEnvelopeType;

        /** MetaEnvelope rxUintnPtr. */
        public rxUintnPtr: Uint8Array;

        /** MetaEnvelope busSerial. */
        public busSerial: string;

        /** MetaEnvelope arcs. */
        public arcs: st3215.IMotorArc[];

        /**
         * Creates a new MetaEnvelope instance using the specified properties.
         * @param [properties] Properties to set
         * @returns MetaEnvelope instance
         */
        public static create(properties?: st3215.IMetaEnvelope): st3215.MetaEnvelope;

        /**
         * Encodes the specified MetaEnvelope message. Does not implicitly {@link st3215.MetaEnvelope.verify|verify} messages.
         * @param message MetaEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IMetaEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified MetaEnvelope message, length delimited. Does not implicitly {@link st3215.MetaEnvelope.verify|verify} messages.
         * @param message MetaEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IMetaEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a MetaEnvelope message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns MetaEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.MetaEnvelope;

        /**
         * Decodes a MetaEnvelope message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns MetaEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.MetaEnvelope;

        /**
         * Verifies a MetaEnvelope message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a MetaEnvelope message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns MetaEnvelope
         */
        public static fromObject(object: { [k: string]: any }): st3215.MetaEnvelope;

        /**
         * Creates a plain object from a MetaEnvelope message. Also converts values to other types if specified.
         * @param message MetaEnvelope
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.MetaEnvelope, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this MetaEnvelope to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for MetaEnvelope
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** CommandResult enum. */
    enum CommandResult {
        CR_PROCESSING = 0,
        CR_SUCCESS = 1,
        CR_REJECTED = 2,
        CR_FAILED = 3
    }

    /** Properties of an InferenceCommandState. */
    interface IInferenceCommandState {

        /** InferenceCommandState command */
        command?: (st3215.ITxEnvelope|null);

        /** InferenceCommandState result */
        result?: (st3215.CommandResult|null);
    }

    /** Represents an InferenceCommandState. */
    class InferenceCommandState implements IInferenceCommandState {

        /**
         * Constructs a new InferenceCommandState.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IInferenceCommandState);

        /** InferenceCommandState command. */
        public command?: (st3215.ITxEnvelope|null);

        /** InferenceCommandState result. */
        public result: st3215.CommandResult;

        /**
         * Creates a new InferenceCommandState instance using the specified properties.
         * @param [properties] Properties to set
         * @returns InferenceCommandState instance
         */
        public static create(properties?: st3215.IInferenceCommandState): st3215.InferenceCommandState;

        /**
         * Encodes the specified InferenceCommandState message. Does not implicitly {@link st3215.InferenceCommandState.verify|verify} messages.
         * @param message InferenceCommandState message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IInferenceCommandState, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified InferenceCommandState message, length delimited. Does not implicitly {@link st3215.InferenceCommandState.verify|verify} messages.
         * @param message InferenceCommandState message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IInferenceCommandState, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an InferenceCommandState message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns InferenceCommandState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.InferenceCommandState;

        /**
         * Decodes an InferenceCommandState message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns InferenceCommandState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.InferenceCommandState;

        /**
         * Verifies an InferenceCommandState message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an InferenceCommandState message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns InferenceCommandState
         */
        public static fromObject(object: { [k: string]: any }): st3215.InferenceCommandState;

        /**
         * Creates a plain object from an InferenceCommandState message. Also converts values to other types if specified.
         * @param message InferenceCommandState
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.InferenceCommandState, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this InferenceCommandState to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for InferenceCommandState
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an AutoCalibrationState. */
    interface IAutoCalibrationState {

        /** AutoCalibrationState status */
        status?: (st3215.AutoCalibrationState.Status|null);

        /** AutoCalibrationState currentStep */
        currentStep?: (number|null);

        /** AutoCalibrationState totalSteps */
        totalSteps?: (number|null);

        /** AutoCalibrationState currentPhase */
        currentPhase?: (string|null);

        /** AutoCalibrationState errorMessage */
        errorMessage?: (string|null);
    }

    /** Represents an AutoCalibrationState. */
    class AutoCalibrationState implements IAutoCalibrationState {

        /**
         * Constructs a new AutoCalibrationState.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IAutoCalibrationState);

        /** AutoCalibrationState status. */
        public status: st3215.AutoCalibrationState.Status;

        /** AutoCalibrationState currentStep. */
        public currentStep: number;

        /** AutoCalibrationState totalSteps. */
        public totalSteps: number;

        /** AutoCalibrationState currentPhase. */
        public currentPhase: string;

        /** AutoCalibrationState errorMessage. */
        public errorMessage: string;

        /**
         * Creates a new AutoCalibrationState instance using the specified properties.
         * @param [properties] Properties to set
         * @returns AutoCalibrationState instance
         */
        public static create(properties?: st3215.IAutoCalibrationState): st3215.AutoCalibrationState;

        /**
         * Encodes the specified AutoCalibrationState message. Does not implicitly {@link st3215.AutoCalibrationState.verify|verify} messages.
         * @param message AutoCalibrationState message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IAutoCalibrationState, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified AutoCalibrationState message, length delimited. Does not implicitly {@link st3215.AutoCalibrationState.verify|verify} messages.
         * @param message AutoCalibrationState message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IAutoCalibrationState, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an AutoCalibrationState message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns AutoCalibrationState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.AutoCalibrationState;

        /**
         * Decodes an AutoCalibrationState message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns AutoCalibrationState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.AutoCalibrationState;

        /**
         * Verifies an AutoCalibrationState message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an AutoCalibrationState message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns AutoCalibrationState
         */
        public static fromObject(object: { [k: string]: any }): st3215.AutoCalibrationState;

        /**
         * Creates a plain object from an AutoCalibrationState message. Also converts values to other types if specified.
         * @param message AutoCalibrationState
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.AutoCalibrationState, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this AutoCalibrationState to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for AutoCalibrationState
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    namespace AutoCalibrationState {

        /** Status enum. */
        enum Status {
            IDLE = 0,
            IN_PROGRESS = 1,
            DONE = 2,
            FAILED = 3,
            STOPPED = 4
        }
    }

    /** Properties of an InferenceState. */
    interface IInferenceState {

        /** InferenceState lastInferenceQueuePtr */
        lastInferenceQueuePtr?: (Uint8Array|null);

        /** InferenceState buses */
        buses?: (st3215.InferenceState.IBusState[]|null);
    }

    /** Represents an InferenceState. */
    class InferenceState implements IInferenceState {

        /**
         * Constructs a new InferenceState.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IInferenceState);

        /** InferenceState lastInferenceQueuePtr. */
        public lastInferenceQueuePtr: Uint8Array;

        /** InferenceState buses. */
        public buses: st3215.InferenceState.IBusState[];

        /**
         * Creates a new InferenceState instance using the specified properties.
         * @param [properties] Properties to set
         * @returns InferenceState instance
         */
        public static create(properties?: st3215.IInferenceState): st3215.InferenceState;

        /**
         * Encodes the specified InferenceState message. Does not implicitly {@link st3215.InferenceState.verify|verify} messages.
         * @param message InferenceState message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IInferenceState, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified InferenceState message, length delimited. Does not implicitly {@link st3215.InferenceState.verify|verify} messages.
         * @param message InferenceState message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IInferenceState, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an InferenceState message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns InferenceState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.InferenceState;

        /**
         * Decodes an InferenceState message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns InferenceState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.InferenceState;

        /**
         * Verifies an InferenceState message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an InferenceState message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns InferenceState
         */
        public static fromObject(object: { [k: string]: any }): st3215.InferenceState;

        /**
         * Creates a plain object from an InferenceState message. Also converts values to other types if specified.
         * @param message InferenceState
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.InferenceState, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this InferenceState to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for InferenceState
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    namespace InferenceState {

        /** Properties of a MotorState. */
        interface IMotorState {

            /** MotorState id */
            id?: (number|null);

            /** MotorState rxPointer */
            rxPointer?: (Uint8Array|null);

            /** MotorState monotonicStampNs */
            monotonicStampNs?: (Long|null);

            /** MotorState systemStampNs */
            systemStampNs?: (Long|null);

            /** MotorState appStartId */
            appStartId?: (Long|null);

            /** MotorState state */
            state?: (Uint8Array|null);

            /** MotorState error */
            error?: (st3215.IST3215Error|null);

            /** MotorState rangeMin */
            rangeMin?: (number|null);

            /** MotorState rangeMax */
            rangeMax?: (number|null);

            /** MotorState rangeFreezed */
            rangeFreezed?: (boolean|null);

            /** MotorState lastCommand */
            lastCommand?: (st3215.IInferenceCommandState|null);
        }

        /** Represents a MotorState. */
        class MotorState implements IMotorState {

            /**
             * Constructs a new MotorState.
             * @param [properties] Properties to set
             */
            constructor(properties?: st3215.InferenceState.IMotorState);

            /** MotorState id. */
            public id: number;

            /** MotorState rxPointer. */
            public rxPointer: Uint8Array;

            /** MotorState monotonicStampNs. */
            public monotonicStampNs: Long;

            /** MotorState systemStampNs. */
            public systemStampNs: Long;

            /** MotorState appStartId. */
            public appStartId: Long;

            /** MotorState state. */
            public state: Uint8Array;

            /** MotorState error. */
            public error?: (st3215.IST3215Error|null);

            /** MotorState rangeMin. */
            public rangeMin: number;

            /** MotorState rangeMax. */
            public rangeMax: number;

            /** MotorState rangeFreezed. */
            public rangeFreezed: boolean;

            /** MotorState lastCommand. */
            public lastCommand?: (st3215.IInferenceCommandState|null);

            /**
             * Creates a new MotorState instance using the specified properties.
             * @param [properties] Properties to set
             * @returns MotorState instance
             */
            public static create(properties?: st3215.InferenceState.IMotorState): st3215.InferenceState.MotorState;

            /**
             * Encodes the specified MotorState message. Does not implicitly {@link st3215.InferenceState.MotorState.verify|verify} messages.
             * @param message MotorState message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: st3215.InferenceState.IMotorState, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified MotorState message, length delimited. Does not implicitly {@link st3215.InferenceState.MotorState.verify|verify} messages.
             * @param message MotorState message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: st3215.InferenceState.IMotorState, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a MotorState message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns MotorState
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.InferenceState.MotorState;

            /**
             * Decodes a MotorState message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns MotorState
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.InferenceState.MotorState;

            /**
             * Verifies a MotorState message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a MotorState message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns MotorState
             */
            public static fromObject(object: { [k: string]: any }): st3215.InferenceState.MotorState;

            /**
             * Creates a plain object from a MotorState message. Also converts values to other types if specified.
             * @param message MotorState
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: st3215.InferenceState.MotorState, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this MotorState to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for MotorState
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of a BusState. */
        interface IBusState {

            /** BusState bus */
            bus?: (st3215.IST3215Bus|null);

            /** BusState monotonicStampNs */
            monotonicStampNs?: (Long|null);

            /** BusState systemStampNs */
            systemStampNs?: (Long|null);

            /** BusState appStartId */
            appStartId?: (Long|null);

            /** BusState motors */
            motors?: (st3215.InferenceState.IMotorState[]|null);

            /** BusState autoCalibration */
            autoCalibration?: (st3215.IAutoCalibrationState|null);
        }

        /** Represents a BusState. */
        class BusState implements IBusState {

            /**
             * Constructs a new BusState.
             * @param [properties] Properties to set
             */
            constructor(properties?: st3215.InferenceState.IBusState);

            /** BusState bus. */
            public bus?: (st3215.IST3215Bus|null);

            /** BusState monotonicStampNs. */
            public monotonicStampNs: Long;

            /** BusState systemStampNs. */
            public systemStampNs: Long;

            /** BusState appStartId. */
            public appStartId: Long;

            /** BusState motors. */
            public motors: st3215.InferenceState.IMotorState[];

            /** BusState autoCalibration. */
            public autoCalibration?: (st3215.IAutoCalibrationState|null);

            /**
             * Creates a new BusState instance using the specified properties.
             * @param [properties] Properties to set
             * @returns BusState instance
             */
            public static create(properties?: st3215.InferenceState.IBusState): st3215.InferenceState.BusState;

            /**
             * Encodes the specified BusState message. Does not implicitly {@link st3215.InferenceState.BusState.verify|verify} messages.
             * @param message BusState message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: st3215.InferenceState.IBusState, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified BusState message, length delimited. Does not implicitly {@link st3215.InferenceState.BusState.verify|verify} messages.
             * @param message BusState message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: st3215.InferenceState.IBusState, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a BusState message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns BusState
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.InferenceState.BusState;

            /**
             * Decodes a BusState message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns BusState
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.InferenceState.BusState;

            /**
             * Verifies a BusState message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a BusState message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns BusState
             */
            public static fromObject(object: { [k: string]: any }): st3215.InferenceState.BusState;

            /**
             * Creates a plain object from a BusState message. Also converts values to other types if specified.
             * @param message BusState
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: st3215.InferenceState.BusState, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this BusState to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for BusState
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }
    }

    /** Properties of a Command. */
    interface ICommand {

        /** Command targetBusSerial */
        targetBusSerial?: (string|null);

        /** Command write */
        write?: (st3215.IST3215WriteCommand|null);

        /** Command regWrite */
        regWrite?: (st3215.IST3215RegWriteCommand|null);

        /** Command action */
        action?: (st3215.IST3215ActionCommand|null);

        /** Command reset */
        reset?: (st3215.IST3215ResetCommand|null);

        /** Command resetCalibration */
        resetCalibration?: (st3215.IResetCalibrationCommand|null);

        /** Command freezeCalibration */
        freezeCalibration?: (st3215.IFreezeCalibrationCommand|null);

        /** Command syncWrite */
        syncWrite?: (st3215.IST3215SyncWriteCommand|null);

        /** Command autoCalibrate */
        autoCalibrate?: (st3215.IAutoCalibrateCommand|null);

        /** Command stopAutoCalibrate */
        stopAutoCalibrate?: (st3215.IStopAutoCalibrateCommand|null);
    }

    /** Represents a Command. */
    class Command implements ICommand {

        /**
         * Constructs a new Command.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.ICommand);

        /** Command targetBusSerial. */
        public targetBusSerial: string;

        /** Command write. */
        public write?: (st3215.IST3215WriteCommand|null);

        /** Command regWrite. */
        public regWrite?: (st3215.IST3215RegWriteCommand|null);

        /** Command action. */
        public action?: (st3215.IST3215ActionCommand|null);

        /** Command reset. */
        public reset?: (st3215.IST3215ResetCommand|null);

        /** Command resetCalibration. */
        public resetCalibration?: (st3215.IResetCalibrationCommand|null);

        /** Command freezeCalibration. */
        public freezeCalibration?: (st3215.IFreezeCalibrationCommand|null);

        /** Command syncWrite. */
        public syncWrite?: (st3215.IST3215SyncWriteCommand|null);

        /** Command autoCalibrate. */
        public autoCalibrate?: (st3215.IAutoCalibrateCommand|null);

        /** Command stopAutoCalibrate. */
        public stopAutoCalibrate?: (st3215.IStopAutoCalibrateCommand|null);

        /**
         * Creates a new Command instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Command instance
         */
        public static create(properties?: st3215.ICommand): st3215.Command;

        /**
         * Encodes the specified Command message. Does not implicitly {@link st3215.Command.verify|verify} messages.
         * @param message Command message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.ICommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Command message, length delimited. Does not implicitly {@link st3215.Command.verify|verify} messages.
         * @param message Command message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.ICommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Command message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Command
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.Command;

        /**
         * Decodes a Command message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Command
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.Command;

        /**
         * Verifies a Command message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Command message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Command
         */
        public static fromObject(object: { [k: string]: any }): st3215.Command;

        /**
         * Creates a plain object from a Command message. Also converts values to other types if specified.
         * @param message Command
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.Command, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Command to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Command
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ResetCalibrationCommand. */
    interface IResetCalibrationCommand {

        /** ResetCalibrationCommand reset */
        reset?: (boolean|null);
    }

    /** Represents a ResetCalibrationCommand. */
    class ResetCalibrationCommand implements IResetCalibrationCommand {

        /**
         * Constructs a new ResetCalibrationCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IResetCalibrationCommand);

        /** ResetCalibrationCommand reset. */
        public reset: boolean;

        /**
         * Creates a new ResetCalibrationCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ResetCalibrationCommand instance
         */
        public static create(properties?: st3215.IResetCalibrationCommand): st3215.ResetCalibrationCommand;

        /**
         * Encodes the specified ResetCalibrationCommand message. Does not implicitly {@link st3215.ResetCalibrationCommand.verify|verify} messages.
         * @param message ResetCalibrationCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IResetCalibrationCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ResetCalibrationCommand message, length delimited. Does not implicitly {@link st3215.ResetCalibrationCommand.verify|verify} messages.
         * @param message ResetCalibrationCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IResetCalibrationCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ResetCalibrationCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ResetCalibrationCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.ResetCalibrationCommand;

        /**
         * Decodes a ResetCalibrationCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ResetCalibrationCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.ResetCalibrationCommand;

        /**
         * Verifies a ResetCalibrationCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ResetCalibrationCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ResetCalibrationCommand
         */
        public static fromObject(object: { [k: string]: any }): st3215.ResetCalibrationCommand;

        /**
         * Creates a plain object from a ResetCalibrationCommand message. Also converts values to other types if specified.
         * @param message ResetCalibrationCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.ResetCalibrationCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ResetCalibrationCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ResetCalibrationCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a FreezeCalibrationCommand. */
    interface IFreezeCalibrationCommand {

        /** FreezeCalibrationCommand freeze */
        freeze?: (boolean|null);

        /** FreezeCalibrationCommand arcs */
        arcs?: (st3215.IFreezeMotorArc[]|null);
    }

    /** Represents a FreezeCalibrationCommand. */
    class FreezeCalibrationCommand implements IFreezeCalibrationCommand {

        /**
         * Constructs a new FreezeCalibrationCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IFreezeCalibrationCommand);

        /** FreezeCalibrationCommand freeze. */
        public freeze: boolean;

        /** FreezeCalibrationCommand arcs. */
        public arcs: st3215.IFreezeMotorArc[];

        /**
         * Creates a new FreezeCalibrationCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns FreezeCalibrationCommand instance
         */
        public static create(properties?: st3215.IFreezeCalibrationCommand): st3215.FreezeCalibrationCommand;

        /**
         * Encodes the specified FreezeCalibrationCommand message. Does not implicitly {@link st3215.FreezeCalibrationCommand.verify|verify} messages.
         * @param message FreezeCalibrationCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IFreezeCalibrationCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified FreezeCalibrationCommand message, length delimited. Does not implicitly {@link st3215.FreezeCalibrationCommand.verify|verify} messages.
         * @param message FreezeCalibrationCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IFreezeCalibrationCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a FreezeCalibrationCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns FreezeCalibrationCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.FreezeCalibrationCommand;

        /**
         * Decodes a FreezeCalibrationCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns FreezeCalibrationCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.FreezeCalibrationCommand;

        /**
         * Verifies a FreezeCalibrationCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a FreezeCalibrationCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns FreezeCalibrationCommand
         */
        public static fromObject(object: { [k: string]: any }): st3215.FreezeCalibrationCommand;

        /**
         * Creates a plain object from a FreezeCalibrationCommand message. Also converts values to other types if specified.
         * @param message FreezeCalibrationCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.FreezeCalibrationCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this FreezeCalibrationCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for FreezeCalibrationCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a FreezeMotorArc. */
    interface IFreezeMotorArc {

        /** FreezeMotorArc motorId */
        motorId?: (number|null);

        /** FreezeMotorArc minAngle */
        minAngle?: (number|null);

        /** FreezeMotorArc maxAngle */
        maxAngle?: (number|null);

        /** FreezeMotorArc midpoint */
        midpoint?: (number|null);
    }

    /** Represents a FreezeMotorArc. */
    class FreezeMotorArc implements IFreezeMotorArc {

        /**
         * Constructs a new FreezeMotorArc.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IFreezeMotorArc);

        /** FreezeMotorArc motorId. */
        public motorId: number;

        /** FreezeMotorArc minAngle. */
        public minAngle: number;

        /** FreezeMotorArc maxAngle. */
        public maxAngle: number;

        /** FreezeMotorArc midpoint. */
        public midpoint: number;

        /**
         * Creates a new FreezeMotorArc instance using the specified properties.
         * @param [properties] Properties to set
         * @returns FreezeMotorArc instance
         */
        public static create(properties?: st3215.IFreezeMotorArc): st3215.FreezeMotorArc;

        /**
         * Encodes the specified FreezeMotorArc message. Does not implicitly {@link st3215.FreezeMotorArc.verify|verify} messages.
         * @param message FreezeMotorArc message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IFreezeMotorArc, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified FreezeMotorArc message, length delimited. Does not implicitly {@link st3215.FreezeMotorArc.verify|verify} messages.
         * @param message FreezeMotorArc message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IFreezeMotorArc, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a FreezeMotorArc message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns FreezeMotorArc
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.FreezeMotorArc;

        /**
         * Decodes a FreezeMotorArc message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns FreezeMotorArc
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.FreezeMotorArc;

        /**
         * Verifies a FreezeMotorArc message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a FreezeMotorArc message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns FreezeMotorArc
         */
        public static fromObject(object: { [k: string]: any }): st3215.FreezeMotorArc;

        /**
         * Creates a plain object from a FreezeMotorArc message. Also converts values to other types if specified.
         * @param message FreezeMotorArc
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.FreezeMotorArc, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this FreezeMotorArc to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for FreezeMotorArc
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an AutoCalibrateCommand. */
    interface IAutoCalibrateCommand {

        /** AutoCalibrateCommand calibrate */
        calibrate?: (boolean|null);
    }

    /** Represents an AutoCalibrateCommand. */
    class AutoCalibrateCommand implements IAutoCalibrateCommand {

        /**
         * Constructs a new AutoCalibrateCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IAutoCalibrateCommand);

        /** AutoCalibrateCommand calibrate. */
        public calibrate: boolean;

        /**
         * Creates a new AutoCalibrateCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns AutoCalibrateCommand instance
         */
        public static create(properties?: st3215.IAutoCalibrateCommand): st3215.AutoCalibrateCommand;

        /**
         * Encodes the specified AutoCalibrateCommand message. Does not implicitly {@link st3215.AutoCalibrateCommand.verify|verify} messages.
         * @param message AutoCalibrateCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IAutoCalibrateCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified AutoCalibrateCommand message, length delimited. Does not implicitly {@link st3215.AutoCalibrateCommand.verify|verify} messages.
         * @param message AutoCalibrateCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IAutoCalibrateCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an AutoCalibrateCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns AutoCalibrateCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.AutoCalibrateCommand;

        /**
         * Decodes an AutoCalibrateCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns AutoCalibrateCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.AutoCalibrateCommand;

        /**
         * Verifies an AutoCalibrateCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an AutoCalibrateCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns AutoCalibrateCommand
         */
        public static fromObject(object: { [k: string]: any }): st3215.AutoCalibrateCommand;

        /**
         * Creates a plain object from an AutoCalibrateCommand message. Also converts values to other types if specified.
         * @param message AutoCalibrateCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.AutoCalibrateCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this AutoCalibrateCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for AutoCalibrateCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a StopAutoCalibrateCommand. */
    interface IStopAutoCalibrateCommand {

        /** StopAutoCalibrateCommand stop */
        stop?: (boolean|null);
    }

    /** Represents a StopAutoCalibrateCommand. */
    class StopAutoCalibrateCommand implements IStopAutoCalibrateCommand {

        /**
         * Constructs a new StopAutoCalibrateCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IStopAutoCalibrateCommand);

        /** StopAutoCalibrateCommand stop. */
        public stop: boolean;

        /**
         * Creates a new StopAutoCalibrateCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns StopAutoCalibrateCommand instance
         */
        public static create(properties?: st3215.IStopAutoCalibrateCommand): st3215.StopAutoCalibrateCommand;

        /**
         * Encodes the specified StopAutoCalibrateCommand message. Does not implicitly {@link st3215.StopAutoCalibrateCommand.verify|verify} messages.
         * @param message StopAutoCalibrateCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IStopAutoCalibrateCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified StopAutoCalibrateCommand message, length delimited. Does not implicitly {@link st3215.StopAutoCalibrateCommand.verify|verify} messages.
         * @param message StopAutoCalibrateCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IStopAutoCalibrateCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a StopAutoCalibrateCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns StopAutoCalibrateCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.StopAutoCalibrateCommand;

        /**
         * Decodes a StopAutoCalibrateCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns StopAutoCalibrateCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.StopAutoCalibrateCommand;

        /**
         * Verifies a StopAutoCalibrateCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a StopAutoCalibrateCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns StopAutoCalibrateCommand
         */
        public static fromObject(object: { [k: string]: any }): st3215.StopAutoCalibrateCommand;

        /**
         * Creates a plain object from a StopAutoCalibrateCommand message. Also converts values to other types if specified.
         * @param message StopAutoCalibrateCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.StopAutoCalibrateCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this StopAutoCalibrateCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for StopAutoCalibrateCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ST3215Bus. */
    interface IST3215Bus {

        /** ST3215Bus portName */
        portName?: (string|null);

        /** ST3215Bus vid */
        vid?: (number|null);

        /** ST3215Bus pid */
        pid?: (number|null);

        /** ST3215Bus serialNumber */
        serialNumber?: (string|null);

        /** ST3215Bus manufacturer */
        manufacturer?: (string|null);

        /** ST3215Bus product */
        product?: (string|null);

        /** ST3215Bus portBaudRate */
        portBaudRate?: (number|null);
    }

    /** Represents a ST3215Bus. */
    class ST3215Bus implements IST3215Bus {

        /**
         * Constructs a new ST3215Bus.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IST3215Bus);

        /** ST3215Bus portName. */
        public portName: string;

        /** ST3215Bus vid. */
        public vid: number;

        /** ST3215Bus pid. */
        public pid: number;

        /** ST3215Bus serialNumber. */
        public serialNumber: string;

        /** ST3215Bus manufacturer. */
        public manufacturer: string;

        /** ST3215Bus product. */
        public product: string;

        /** ST3215Bus portBaudRate. */
        public portBaudRate: number;

        /**
         * Creates a new ST3215Bus instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ST3215Bus instance
         */
        public static create(properties?: st3215.IST3215Bus): st3215.ST3215Bus;

        /**
         * Encodes the specified ST3215Bus message. Does not implicitly {@link st3215.ST3215Bus.verify|verify} messages.
         * @param message ST3215Bus message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IST3215Bus, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ST3215Bus message, length delimited. Does not implicitly {@link st3215.ST3215Bus.verify|verify} messages.
         * @param message ST3215Bus message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IST3215Bus, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ST3215Bus message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ST3215Bus
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.ST3215Bus;

        /**
         * Decodes a ST3215Bus message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ST3215Bus
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.ST3215Bus;

        /**
         * Verifies a ST3215Bus message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ST3215Bus message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ST3215Bus
         */
        public static fromObject(object: { [k: string]: any }): st3215.ST3215Bus;

        /**
         * Creates a plain object from a ST3215Bus message. Also converts values to other types if specified.
         * @param message ST3215Bus
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.ST3215Bus, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ST3215Bus to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ST3215Bus
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ST3215SignalData. */
    interface IST3215SignalData {

        /** ST3215SignalData portName */
        portName?: (string|null);

        /** ST3215SignalData motorId */
        motorId?: (number|null);

        /** ST3215SignalData type */
        type?: (st3215.ST3215SignalType|null);

        /** ST3215SignalData baudRate */
        baudRate?: (number|null);

        /** ST3215SignalData data */
        data?: (Uint8Array|null);
    }

    /** Represents a ST3215SignalData. */
    class ST3215SignalData implements IST3215SignalData {

        /**
         * Constructs a new ST3215SignalData.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IST3215SignalData);

        /** ST3215SignalData portName. */
        public portName: string;

        /** ST3215SignalData motorId. */
        public motorId: number;

        /** ST3215SignalData type. */
        public type: st3215.ST3215SignalType;

        /** ST3215SignalData baudRate. */
        public baudRate: number;

        /** ST3215SignalData data. */
        public data: Uint8Array;

        /**
         * Creates a new ST3215SignalData instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ST3215SignalData instance
         */
        public static create(properties?: st3215.IST3215SignalData): st3215.ST3215SignalData;

        /**
         * Encodes the specified ST3215SignalData message. Does not implicitly {@link st3215.ST3215SignalData.verify|verify} messages.
         * @param message ST3215SignalData message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IST3215SignalData, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ST3215SignalData message, length delimited. Does not implicitly {@link st3215.ST3215SignalData.verify|verify} messages.
         * @param message ST3215SignalData message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IST3215SignalData, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ST3215SignalData message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ST3215SignalData
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.ST3215SignalData;

        /**
         * Decodes a ST3215SignalData message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ST3215SignalData
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.ST3215SignalData;

        /**
         * Verifies a ST3215SignalData message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ST3215SignalData message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ST3215SignalData
         */
        public static fromObject(object: { [k: string]: any }): st3215.ST3215SignalData;

        /**
         * Creates a plain object from a ST3215SignalData message. Also converts values to other types if specified.
         * @param message ST3215SignalData
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.ST3215SignalData, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ST3215SignalData to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ST3215SignalData
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ST3215WriteCommand. */
    interface IST3215WriteCommand {

        /** ST3215WriteCommand motorId */
        motorId?: (number|null);

        /** ST3215WriteCommand address */
        address?: (number|null);

        /** ST3215WriteCommand value */
        value?: (Uint8Array|null);
    }

    /** Represents a ST3215WriteCommand. */
    class ST3215WriteCommand implements IST3215WriteCommand {

        /**
         * Constructs a new ST3215WriteCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IST3215WriteCommand);

        /** ST3215WriteCommand motorId. */
        public motorId: number;

        /** ST3215WriteCommand address. */
        public address: number;

        /** ST3215WriteCommand value. */
        public value: Uint8Array;

        /**
         * Creates a new ST3215WriteCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ST3215WriteCommand instance
         */
        public static create(properties?: st3215.IST3215WriteCommand): st3215.ST3215WriteCommand;

        /**
         * Encodes the specified ST3215WriteCommand message. Does not implicitly {@link st3215.ST3215WriteCommand.verify|verify} messages.
         * @param message ST3215WriteCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IST3215WriteCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ST3215WriteCommand message, length delimited. Does not implicitly {@link st3215.ST3215WriteCommand.verify|verify} messages.
         * @param message ST3215WriteCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IST3215WriteCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ST3215WriteCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ST3215WriteCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.ST3215WriteCommand;

        /**
         * Decodes a ST3215WriteCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ST3215WriteCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.ST3215WriteCommand;

        /**
         * Verifies a ST3215WriteCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ST3215WriteCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ST3215WriteCommand
         */
        public static fromObject(object: { [k: string]: any }): st3215.ST3215WriteCommand;

        /**
         * Creates a plain object from a ST3215WriteCommand message. Also converts values to other types if specified.
         * @param message ST3215WriteCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.ST3215WriteCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ST3215WriteCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ST3215WriteCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ST3215RegWriteCommand. */
    interface IST3215RegWriteCommand {

        /** ST3215RegWriteCommand motorId */
        motorId?: (number|null);

        /** ST3215RegWriteCommand address */
        address?: (number|null);

        /** ST3215RegWriteCommand value */
        value?: (Uint8Array|null);
    }

    /** Represents a ST3215RegWriteCommand. */
    class ST3215RegWriteCommand implements IST3215RegWriteCommand {

        /**
         * Constructs a new ST3215RegWriteCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IST3215RegWriteCommand);

        /** ST3215RegWriteCommand motorId. */
        public motorId: number;

        /** ST3215RegWriteCommand address. */
        public address: number;

        /** ST3215RegWriteCommand value. */
        public value: Uint8Array;

        /**
         * Creates a new ST3215RegWriteCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ST3215RegWriteCommand instance
         */
        public static create(properties?: st3215.IST3215RegWriteCommand): st3215.ST3215RegWriteCommand;

        /**
         * Encodes the specified ST3215RegWriteCommand message. Does not implicitly {@link st3215.ST3215RegWriteCommand.verify|verify} messages.
         * @param message ST3215RegWriteCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IST3215RegWriteCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ST3215RegWriteCommand message, length delimited. Does not implicitly {@link st3215.ST3215RegWriteCommand.verify|verify} messages.
         * @param message ST3215RegWriteCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IST3215RegWriteCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ST3215RegWriteCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ST3215RegWriteCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.ST3215RegWriteCommand;

        /**
         * Decodes a ST3215RegWriteCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ST3215RegWriteCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.ST3215RegWriteCommand;

        /**
         * Verifies a ST3215RegWriteCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ST3215RegWriteCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ST3215RegWriteCommand
         */
        public static fromObject(object: { [k: string]: any }): st3215.ST3215RegWriteCommand;

        /**
         * Creates a plain object from a ST3215RegWriteCommand message. Also converts values to other types if specified.
         * @param message ST3215RegWriteCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.ST3215RegWriteCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ST3215RegWriteCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ST3215RegWriteCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ST3215ActionCommand. */
    interface IST3215ActionCommand {

        /** ST3215ActionCommand motorId */
        motorId?: (number|null);
    }

    /** Represents a ST3215ActionCommand. */
    class ST3215ActionCommand implements IST3215ActionCommand {

        /**
         * Constructs a new ST3215ActionCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IST3215ActionCommand);

        /** ST3215ActionCommand motorId. */
        public motorId: number;

        /**
         * Creates a new ST3215ActionCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ST3215ActionCommand instance
         */
        public static create(properties?: st3215.IST3215ActionCommand): st3215.ST3215ActionCommand;

        /**
         * Encodes the specified ST3215ActionCommand message. Does not implicitly {@link st3215.ST3215ActionCommand.verify|verify} messages.
         * @param message ST3215ActionCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IST3215ActionCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ST3215ActionCommand message, length delimited. Does not implicitly {@link st3215.ST3215ActionCommand.verify|verify} messages.
         * @param message ST3215ActionCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IST3215ActionCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ST3215ActionCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ST3215ActionCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.ST3215ActionCommand;

        /**
         * Decodes a ST3215ActionCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ST3215ActionCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.ST3215ActionCommand;

        /**
         * Verifies a ST3215ActionCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ST3215ActionCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ST3215ActionCommand
         */
        public static fromObject(object: { [k: string]: any }): st3215.ST3215ActionCommand;

        /**
         * Creates a plain object from a ST3215ActionCommand message. Also converts values to other types if specified.
         * @param message ST3215ActionCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.ST3215ActionCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ST3215ActionCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ST3215ActionCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ST3215SyncWriteCommand. */
    interface IST3215SyncWriteCommand {

        /** ST3215SyncWriteCommand address */
        address?: (number|null);

        /** ST3215SyncWriteCommand motors */
        motors?: (st3215.ST3215SyncWriteCommand.IMotorWrite[]|null);
    }

    /** Represents a ST3215SyncWriteCommand. */
    class ST3215SyncWriteCommand implements IST3215SyncWriteCommand {

        /**
         * Constructs a new ST3215SyncWriteCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IST3215SyncWriteCommand);

        /** ST3215SyncWriteCommand address. */
        public address: number;

        /** ST3215SyncWriteCommand motors. */
        public motors: st3215.ST3215SyncWriteCommand.IMotorWrite[];

        /**
         * Creates a new ST3215SyncWriteCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ST3215SyncWriteCommand instance
         */
        public static create(properties?: st3215.IST3215SyncWriteCommand): st3215.ST3215SyncWriteCommand;

        /**
         * Encodes the specified ST3215SyncWriteCommand message. Does not implicitly {@link st3215.ST3215SyncWriteCommand.verify|verify} messages.
         * @param message ST3215SyncWriteCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IST3215SyncWriteCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ST3215SyncWriteCommand message, length delimited. Does not implicitly {@link st3215.ST3215SyncWriteCommand.verify|verify} messages.
         * @param message ST3215SyncWriteCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IST3215SyncWriteCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ST3215SyncWriteCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ST3215SyncWriteCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.ST3215SyncWriteCommand;

        /**
         * Decodes a ST3215SyncWriteCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ST3215SyncWriteCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.ST3215SyncWriteCommand;

        /**
         * Verifies a ST3215SyncWriteCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ST3215SyncWriteCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ST3215SyncWriteCommand
         */
        public static fromObject(object: { [k: string]: any }): st3215.ST3215SyncWriteCommand;

        /**
         * Creates a plain object from a ST3215SyncWriteCommand message. Also converts values to other types if specified.
         * @param message ST3215SyncWriteCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.ST3215SyncWriteCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ST3215SyncWriteCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ST3215SyncWriteCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    namespace ST3215SyncWriteCommand {

        /** Properties of a MotorWrite. */
        interface IMotorWrite {

            /** MotorWrite motorId */
            motorId?: (number|null);

            /** MotorWrite value */
            value?: (Uint8Array|null);
        }

        /** Represents a MotorWrite. */
        class MotorWrite implements IMotorWrite {

            /**
             * Constructs a new MotorWrite.
             * @param [properties] Properties to set
             */
            constructor(properties?: st3215.ST3215SyncWriteCommand.IMotorWrite);

            /** MotorWrite motorId. */
            public motorId: number;

            /** MotorWrite value. */
            public value: Uint8Array;

            /**
             * Creates a new MotorWrite instance using the specified properties.
             * @param [properties] Properties to set
             * @returns MotorWrite instance
             */
            public static create(properties?: st3215.ST3215SyncWriteCommand.IMotorWrite): st3215.ST3215SyncWriteCommand.MotorWrite;

            /**
             * Encodes the specified MotorWrite message. Does not implicitly {@link st3215.ST3215SyncWriteCommand.MotorWrite.verify|verify} messages.
             * @param message MotorWrite message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: st3215.ST3215SyncWriteCommand.IMotorWrite, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified MotorWrite message, length delimited. Does not implicitly {@link st3215.ST3215SyncWriteCommand.MotorWrite.verify|verify} messages.
             * @param message MotorWrite message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: st3215.ST3215SyncWriteCommand.IMotorWrite, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a MotorWrite message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns MotorWrite
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.ST3215SyncWriteCommand.MotorWrite;

            /**
             * Decodes a MotorWrite message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns MotorWrite
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.ST3215SyncWriteCommand.MotorWrite;

            /**
             * Verifies a MotorWrite message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a MotorWrite message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns MotorWrite
             */
            public static fromObject(object: { [k: string]: any }): st3215.ST3215SyncWriteCommand.MotorWrite;

            /**
             * Creates a plain object from a MotorWrite message. Also converts values to other types if specified.
             * @param message MotorWrite
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: st3215.ST3215SyncWriteCommand.MotorWrite, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this MotorWrite to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for MotorWrite
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }
    }

    /** Properties of a ST3215ResetCommand. */
    interface IST3215ResetCommand {

        /** ST3215ResetCommand portName */
        portName?: (string|null);

        /** ST3215ResetCommand motorId */
        motorId?: (number|null);
    }

    /** Represents a ST3215ResetCommand. */
    class ST3215ResetCommand implements IST3215ResetCommand {

        /**
         * Constructs a new ST3215ResetCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IST3215ResetCommand);

        /** ST3215ResetCommand portName. */
        public portName: string;

        /** ST3215ResetCommand motorId. */
        public motorId: number;

        /**
         * Creates a new ST3215ResetCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ST3215ResetCommand instance
         */
        public static create(properties?: st3215.IST3215ResetCommand): st3215.ST3215ResetCommand;

        /**
         * Encodes the specified ST3215ResetCommand message. Does not implicitly {@link st3215.ST3215ResetCommand.verify|verify} messages.
         * @param message ST3215ResetCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IST3215ResetCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ST3215ResetCommand message, length delimited. Does not implicitly {@link st3215.ST3215ResetCommand.verify|verify} messages.
         * @param message ST3215ResetCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IST3215ResetCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ST3215ResetCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ST3215ResetCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.ST3215ResetCommand;

        /**
         * Decodes a ST3215ResetCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ST3215ResetCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.ST3215ResetCommand;

        /**
         * Verifies a ST3215ResetCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ST3215ResetCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ST3215ResetCommand
         */
        public static fromObject(object: { [k: string]: any }): st3215.ST3215ResetCommand;

        /**
         * Creates a plain object from a ST3215ResetCommand message. Also converts values to other types if specified.
         * @param message ST3215ResetCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.ST3215ResetCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ST3215ResetCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ST3215ResetCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** MetaEnvelopeType enum. */
    enum MetaEnvelopeType {
        MET_UNKNOWN = 0,
        MET_RESET_CALIBRATION = 1,
        MET_FREEZE_CALIBRATION = 2
    }

    /** Properties of a MotorArc. */
    interface IMotorArc {

        /** MotorArc motorId */
        motorId?: (number|null);

        /** MotorArc minAngle */
        minAngle?: (number|null);

        /** MotorArc maxAngle */
        maxAngle?: (number|null);

        /** MotorArc rangeFreezed */
        rangeFreezed?: (boolean|null);

        /** MotorArc positions */
        positions?: (number[]|null);
    }

    /** Represents a MotorArc. */
    class MotorArc implements IMotorArc {

        /**
         * Constructs a new MotorArc.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IMotorArc);

        /** MotorArc motorId. */
        public motorId: number;

        /** MotorArc minAngle. */
        public minAngle: number;

        /** MotorArc maxAngle. */
        public maxAngle: number;

        /** MotorArc rangeFreezed. */
        public rangeFreezed: boolean;

        /** MotorArc positions. */
        public positions: number[];

        /**
         * Creates a new MotorArc instance using the specified properties.
         * @param [properties] Properties to set
         * @returns MotorArc instance
         */
        public static create(properties?: st3215.IMotorArc): st3215.MotorArc;

        /**
         * Encodes the specified MotorArc message. Does not implicitly {@link st3215.MotorArc.verify|verify} messages.
         * @param message MotorArc message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IMotorArc, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified MotorArc message, length delimited. Does not implicitly {@link st3215.MotorArc.verify|verify} messages.
         * @param message MotorArc message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IMotorArc, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a MotorArc message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns MotorArc
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.MotorArc;

        /**
         * Decodes a MotorArc message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns MotorArc
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.MotorArc;

        /**
         * Verifies a MotorArc message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a MotorArc message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns MotorArc
         */
        public static fromObject(object: { [k: string]: any }): st3215.MotorArc;

        /**
         * Creates a plain object from a MotorArc message. Also converts values to other types if specified.
         * @param message MotorArc
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.MotorArc, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this MotorArc to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for MotorArc
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ST3215Error. */
    interface IST3215Error {

        /** ST3215Error kind */
        kind?: (st3215.ST3215Error.ST3215ErrorKind|null);

        /** ST3215Error commandPacket */
        commandPacket?: (Uint8Array|null);

        /** ST3215Error responsePacket */
        responsePacket?: (Uint8Array|null);

        /** ST3215Error description */
        description?: (string|null);

        /** ST3215Error servo */
        servo?: (st3215.ST3215Error.ServoErrorType[]|null);
    }

    /** Represents a ST3215Error. */
    class ST3215Error implements IST3215Error {

        /**
         * Constructs a new ST3215Error.
         * @param [properties] Properties to set
         */
        constructor(properties?: st3215.IST3215Error);

        /** ST3215Error kind. */
        public kind: st3215.ST3215Error.ST3215ErrorKind;

        /** ST3215Error commandPacket. */
        public commandPacket: Uint8Array;

        /** ST3215Error responsePacket. */
        public responsePacket: Uint8Array;

        /** ST3215Error description. */
        public description: string;

        /** ST3215Error servo. */
        public servo: st3215.ST3215Error.ServoErrorType[];

        /**
         * Creates a new ST3215Error instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ST3215Error instance
         */
        public static create(properties?: st3215.IST3215Error): st3215.ST3215Error;

        /**
         * Encodes the specified ST3215Error message. Does not implicitly {@link st3215.ST3215Error.verify|verify} messages.
         * @param message ST3215Error message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: st3215.IST3215Error, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ST3215Error message, length delimited. Does not implicitly {@link st3215.ST3215Error.verify|verify} messages.
         * @param message ST3215Error message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: st3215.IST3215Error, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ST3215Error message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ST3215Error
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): st3215.ST3215Error;

        /**
         * Decodes a ST3215Error message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ST3215Error
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): st3215.ST3215Error;

        /**
         * Verifies a ST3215Error message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ST3215Error message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ST3215Error
         */
        public static fromObject(object: { [k: string]: any }): st3215.ST3215Error;

        /**
         * Creates a plain object from a ST3215Error message. Also converts values to other types if specified.
         * @param message ST3215Error
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: st3215.ST3215Error, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ST3215Error to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ST3215Error
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    namespace ST3215Error {

        /** ServoErrorType enum. */
        enum ServoErrorType {
            SET_INSTRUCTION = 0,
            SET_OVERLOAD = 1,
            SET_CHECKSUM = 2,
            SET_RANGE = 3,
            SET_OVERHEAT = 4,
            SET_ANGLE_LIMIT = 5,
            SET_VOLTAGE = 6
        }

        /** ST3215ErrorKind enum. */
        enum ST3215ErrorKind {
            SEK_IO = 0,
            SEK_INVALID_HEADER = 1,
            SEK_INVALID_CHECKSUM = 2,
            SEK_SERVO_ERROR = 3,
            SEK_MOTOR_ID_ERROR = 4,
            SEK_INVALID_DATA = 5,
            SEK_TIMEOUT = 6
        }
    }
}

/** Namespace usbvideo. */
export namespace usbvideo {

    /** RxEnvelopeType enum. */
    enum RxEnvelopeType {
        ET_FRAMES = 0,
        ET_DEVICE_CONNECTED = 1,
        ET_DEVICE_RECORDING_START = 3,
        ET_DEVICE_RECORDING_END = 4,
        ET_DEVICE_DISCONNECTED = 5,
        ET_ERROR = 6
    }

    /** Properties of a RxEnvelope. */
    interface IRxEnvelope {

        /** RxEnvelope type */
        type?: (usbvideo.RxEnvelopeType|null);

        /** RxEnvelope stamp */
        stamp?: (frame.IFrameStamp|null);

        /** RxEnvelope camera */
        camera?: (usbvideo.ICamera|null);

        /** RxEnvelope formats */
        formats?: (usbvideo.ICameraFormat[]|null);

        /** RxEnvelope error */
        error?: (string|null);

        /** RxEnvelope lastInferenceQueuePtr */
        lastInferenceQueuePtr?: (Uint8Array|null);

        /** RxEnvelope frames */
        frames?: (frame.IFramesPack|null);
    }

    /** Represents a RxEnvelope. */
    class RxEnvelope implements IRxEnvelope {

        /**
         * Constructs a new RxEnvelope.
         * @param [properties] Properties to set
         */
        constructor(properties?: usbvideo.IRxEnvelope);

        /** RxEnvelope type. */
        public type: usbvideo.RxEnvelopeType;

        /** RxEnvelope stamp. */
        public stamp?: (frame.IFrameStamp|null);

        /** RxEnvelope camera. */
        public camera?: (usbvideo.ICamera|null);

        /** RxEnvelope formats. */
        public formats: usbvideo.ICameraFormat[];

        /** RxEnvelope error. */
        public error: string;

        /** RxEnvelope lastInferenceQueuePtr. */
        public lastInferenceQueuePtr: Uint8Array;

        /** RxEnvelope frames. */
        public frames?: (frame.IFramesPack|null);

        /**
         * Creates a new RxEnvelope instance using the specified properties.
         * @param [properties] Properties to set
         * @returns RxEnvelope instance
         */
        public static create(properties?: usbvideo.IRxEnvelope): usbvideo.RxEnvelope;

        /**
         * Encodes the specified RxEnvelope message. Does not implicitly {@link usbvideo.RxEnvelope.verify|verify} messages.
         * @param message RxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: usbvideo.IRxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified RxEnvelope message, length delimited. Does not implicitly {@link usbvideo.RxEnvelope.verify|verify} messages.
         * @param message RxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: usbvideo.IRxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a RxEnvelope message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns RxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): usbvideo.RxEnvelope;

        /**
         * Decodes a RxEnvelope message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns RxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): usbvideo.RxEnvelope;

        /**
         * Verifies a RxEnvelope message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a RxEnvelope message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns RxEnvelope
         */
        public static fromObject(object: { [k: string]: any }): usbvideo.RxEnvelope;

        /**
         * Creates a plain object from a RxEnvelope message. Also converts values to other types if specified.
         * @param message RxEnvelope
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: usbvideo.RxEnvelope, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this RxEnvelope to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for RxEnvelope
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a Camera. */
    interface ICamera {

        /** Camera vendorId */
        vendorId?: (number|null);

        /** Camera productId */
        productId?: (number|null);

        /** Camera serialNumber */
        serialNumber?: (string|null);

        /** Camera manufacturer */
        manufacturer?: (string|null);

        /** Camera product */
        product?: (string|null);

        /** Camera busNumber */
        busNumber?: (number|null);

        /** Camera deviceNumber */
        deviceNumber?: (number|null);

        /** Camera uniqueId */
        uniqueId?: (string|null);
    }

    /** Represents a Camera. */
    class Camera implements ICamera {

        /**
         * Constructs a new Camera.
         * @param [properties] Properties to set
         */
        constructor(properties?: usbvideo.ICamera);

        /** Camera vendorId. */
        public vendorId: number;

        /** Camera productId. */
        public productId: number;

        /** Camera serialNumber. */
        public serialNumber: string;

        /** Camera manufacturer. */
        public manufacturer: string;

        /** Camera product. */
        public product: string;

        /** Camera busNumber. */
        public busNumber: number;

        /** Camera deviceNumber. */
        public deviceNumber: number;

        /** Camera uniqueId. */
        public uniqueId: string;

        /**
         * Creates a new Camera instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Camera instance
         */
        public static create(properties?: usbvideo.ICamera): usbvideo.Camera;

        /**
         * Encodes the specified Camera message. Does not implicitly {@link usbvideo.Camera.verify|verify} messages.
         * @param message Camera message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: usbvideo.ICamera, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Camera message, length delimited. Does not implicitly {@link usbvideo.Camera.verify|verify} messages.
         * @param message Camera message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: usbvideo.ICamera, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Camera message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Camera
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): usbvideo.Camera;

        /**
         * Decodes a Camera message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Camera
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): usbvideo.Camera;

        /**
         * Verifies a Camera message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Camera message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Camera
         */
        public static fromObject(object: { [k: string]: any }): usbvideo.Camera;

        /**
         * Creates a plain object from a Camera message. Also converts values to other types if specified.
         * @param message Camera
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: usbvideo.Camera, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Camera to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Camera
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a CameraFormat. */
    interface ICameraFormat {

        /** CameraFormat fourcc */
        fourcc?: (number|null);

        /** CameraFormat index */
        index?: (number|null);

        /** CameraFormat width */
        width?: (number|null);

        /** CameraFormat height */
        height?: (number|null);

        /** CameraFormat framesPerSecond */
        framesPerSecond?: (number|null);

        /** CameraFormat guid */
        guid?: (Uint8Array|null);

        /** CameraFormat frameIndex */
        frameIndex?: (number|null);
    }

    /** Represents a CameraFormat. */
    class CameraFormat implements ICameraFormat {

        /**
         * Constructs a new CameraFormat.
         * @param [properties] Properties to set
         */
        constructor(properties?: usbvideo.ICameraFormat);

        /** CameraFormat fourcc. */
        public fourcc: number;

        /** CameraFormat index. */
        public index: number;

        /** CameraFormat width. */
        public width: number;

        /** CameraFormat height. */
        public height: number;

        /** CameraFormat framesPerSecond. */
        public framesPerSecond: number;

        /** CameraFormat guid. */
        public guid: Uint8Array;

        /** CameraFormat frameIndex. */
        public frameIndex: number;

        /**
         * Creates a new CameraFormat instance using the specified properties.
         * @param [properties] Properties to set
         * @returns CameraFormat instance
         */
        public static create(properties?: usbvideo.ICameraFormat): usbvideo.CameraFormat;

        /**
         * Encodes the specified CameraFormat message. Does not implicitly {@link usbvideo.CameraFormat.verify|verify} messages.
         * @param message CameraFormat message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: usbvideo.ICameraFormat, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified CameraFormat message, length delimited. Does not implicitly {@link usbvideo.CameraFormat.verify|verify} messages.
         * @param message CameraFormat message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: usbvideo.ICameraFormat, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a CameraFormat message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns CameraFormat
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): usbvideo.CameraFormat;

        /**
         * Decodes a CameraFormat message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns CameraFormat
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): usbvideo.CameraFormat;

        /**
         * Verifies a CameraFormat message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a CameraFormat message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns CameraFormat
         */
        public static fromObject(object: { [k: string]: any }): usbvideo.CameraFormat;

        /**
         * Creates a plain object from a CameraFormat message. Also converts values to other types if specified.
         * @param message CameraFormat
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: usbvideo.CameraFormat, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this CameraFormat to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for CameraFormat
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }
}

/** Namespace frame. */
export namespace frame {

    /** Properties of a FramesPack. */
    interface IFramesPack {

        /** FramesPack format */
        format?: (frame.IFrameFormat|null);

        /** FramesPack stamps */
        stamps?: (frame.IFrameStamp[]|null);

        /** FramesPack linearData */
        linearData?: (Uint8Array|null);

        /** FramesPack framesData */
        framesData?: (Uint8Array[]|null);
    }

    /** Represents a FramesPack. */
    class FramesPack implements IFramesPack {

        /**
         * Constructs a new FramesPack.
         * @param [properties] Properties to set
         */
        constructor(properties?: frame.IFramesPack);

        /** FramesPack format. */
        public format?: (frame.IFrameFormat|null);

        /** FramesPack stamps. */
        public stamps: frame.IFrameStamp[];

        /** FramesPack linearData. */
        public linearData: Uint8Array;

        /** FramesPack framesData. */
        public framesData: Uint8Array[];

        /**
         * Creates a new FramesPack instance using the specified properties.
         * @param [properties] Properties to set
         * @returns FramesPack instance
         */
        public static create(properties?: frame.IFramesPack): frame.FramesPack;

        /**
         * Encodes the specified FramesPack message. Does not implicitly {@link frame.FramesPack.verify|verify} messages.
         * @param message FramesPack message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: frame.IFramesPack, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified FramesPack message, length delimited. Does not implicitly {@link frame.FramesPack.verify|verify} messages.
         * @param message FramesPack message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: frame.IFramesPack, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a FramesPack message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns FramesPack
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): frame.FramesPack;

        /**
         * Decodes a FramesPack message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns FramesPack
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): frame.FramesPack;

        /**
         * Verifies a FramesPack message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a FramesPack message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns FramesPack
         */
        public static fromObject(object: { [k: string]: any }): frame.FramesPack;

        /**
         * Creates a plain object from a FramesPack message. Also converts values to other types if specified.
         * @param message FramesPack
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: frame.FramesPack, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this FramesPack to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for FramesPack
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a FrameStamp. */
    interface IFrameStamp {

        /** FrameStamp monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** FrameStamp localStampNs */
        localStampNs?: (Long|null);

        /** FrameStamp appStartId */
        appStartId?: (Long|null);

        /** FrameStamp index */
        index?: (Long|null);
    }

    /** Represents a FrameStamp. */
    class FrameStamp implements IFrameStamp {

        /**
         * Constructs a new FrameStamp.
         * @param [properties] Properties to set
         */
        constructor(properties?: frame.IFrameStamp);

        /** FrameStamp monotonicStampNs. */
        public monotonicStampNs: Long;

        /** FrameStamp localStampNs. */
        public localStampNs: Long;

        /** FrameStamp appStartId. */
        public appStartId: Long;

        /** FrameStamp index. */
        public index: Long;

        /**
         * Creates a new FrameStamp instance using the specified properties.
         * @param [properties] Properties to set
         * @returns FrameStamp instance
         */
        public static create(properties?: frame.IFrameStamp): frame.FrameStamp;

        /**
         * Encodes the specified FrameStamp message. Does not implicitly {@link frame.FrameStamp.verify|verify} messages.
         * @param message FrameStamp message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: frame.IFrameStamp, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified FrameStamp message, length delimited. Does not implicitly {@link frame.FrameStamp.verify|verify} messages.
         * @param message FrameStamp message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: frame.IFrameStamp, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a FrameStamp message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns FrameStamp
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): frame.FrameStamp;

        /**
         * Decodes a FrameStamp message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns FrameStamp
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): frame.FrameStamp;

        /**
         * Verifies a FrameStamp message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a FrameStamp message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns FrameStamp
         */
        public static fromObject(object: { [k: string]: any }): frame.FrameStamp;

        /**
         * Creates a plain object from a FrameStamp message. Also converts values to other types if specified.
         * @param message FrameStamp
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: frame.FrameStamp, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this FrameStamp to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for FrameStamp
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** FrameFormatKind enum. */
    enum FrameFormatKind {
        FF_NCHW = 0,
        FF_JPEG = 1
    }

    /** Properties of a FrameFormat. */
    interface IFrameFormat {

        /** FrameFormat width */
        width?: (number|null);

        /** FrameFormat height */
        height?: (number|null);

        /** FrameFormat kind */
        kind?: (frame.FrameFormatKind|null);
    }

    /** Represents a FrameFormat. */
    class FrameFormat implements IFrameFormat {

        /**
         * Constructs a new FrameFormat.
         * @param [properties] Properties to set
         */
        constructor(properties?: frame.IFrameFormat);

        /** FrameFormat width. */
        public width: number;

        /** FrameFormat height. */
        public height: number;

        /** FrameFormat kind. */
        public kind: frame.FrameFormatKind;

        /**
         * Creates a new FrameFormat instance using the specified properties.
         * @param [properties] Properties to set
         * @returns FrameFormat instance
         */
        public static create(properties?: frame.IFrameFormat): frame.FrameFormat;

        /**
         * Encodes the specified FrameFormat message. Does not implicitly {@link frame.FrameFormat.verify|verify} messages.
         * @param message FrameFormat message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: frame.IFrameFormat, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified FrameFormat message, length delimited. Does not implicitly {@link frame.FrameFormat.verify|verify} messages.
         * @param message FrameFormat message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: frame.IFrameFormat, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a FrameFormat message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns FrameFormat
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): frame.FrameFormat;

        /**
         * Decodes a FrameFormat message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns FrameFormat
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): frame.FrameFormat;

        /**
         * Verifies a FrameFormat message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a FrameFormat message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns FrameFormat
         */
        public static fromObject(object: { [k: string]: any }): frame.FrameFormat;

        /**
         * Creates a plain object from a FrameFormat message. Also converts values to other types if specified.
         * @param message FrameFormat
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: frame.FrameFormat, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this FrameFormat to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for FrameFormat
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }
}

/** Namespace motors_mirroring. */
export namespace motors_mirroring {

    /** BusType enum. */
    enum BusType {
        MBT_ST3215 = 0
    }

    /** BusMode enum. */
    enum BusMode {
        BR_UNKNOWN = 0,
        BR_LEADER = 1,
        BR_FOLLOWER = 2
    }

    /** Properties of a MirroringBus. */
    interface IMirroringBus {

        /** MirroringBus type */
        type?: (motors_mirroring.BusType|null);

        /** MirroringBus uniqueId */
        uniqueId?: (string|null);
    }

    /** Represents a MirroringBus. */
    class MirroringBus implements IMirroringBus {

        /**
         * Constructs a new MirroringBus.
         * @param [properties] Properties to set
         */
        constructor(properties?: motors_mirroring.IMirroringBus);

        /** MirroringBus type. */
        public type: motors_mirroring.BusType;

        /** MirroringBus uniqueId. */
        public uniqueId: string;

        /**
         * Creates a new MirroringBus instance using the specified properties.
         * @param [properties] Properties to set
         * @returns MirroringBus instance
         */
        public static create(properties?: motors_mirroring.IMirroringBus): motors_mirroring.MirroringBus;

        /**
         * Encodes the specified MirroringBus message. Does not implicitly {@link motors_mirroring.MirroringBus.verify|verify} messages.
         * @param message MirroringBus message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: motors_mirroring.IMirroringBus, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified MirroringBus message, length delimited. Does not implicitly {@link motors_mirroring.MirroringBus.verify|verify} messages.
         * @param message MirroringBus message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: motors_mirroring.IMirroringBus, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a MirroringBus message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns MirroringBus
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): motors_mirroring.MirroringBus;

        /**
         * Decodes a MirroringBus message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns MirroringBus
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): motors_mirroring.MirroringBus;

        /**
         * Verifies a MirroringBus message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a MirroringBus message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns MirroringBus
         */
        public static fromObject(object: { [k: string]: any }): motors_mirroring.MirroringBus;

        /**
         * Creates a plain object from a MirroringBus message. Also converts values to other types if specified.
         * @param message MirroringBus
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: motors_mirroring.MirroringBus, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this MirroringBus to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for MirroringBus
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ModeEnvelope. */
    interface IModeEnvelope {

        /** ModeEnvelope monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** ModeEnvelope localStampNs */
        localStampNs?: (Long|null);

        /** ModeEnvelope appStartId */
        appStartId?: (Long|null);

        /** ModeEnvelope bus */
        bus?: (motors_mirroring.IMirroringBus|null);

        /** ModeEnvelope mode */
        mode?: (motors_mirroring.BusMode|null);
    }

    /** Represents a ModeEnvelope. */
    class ModeEnvelope implements IModeEnvelope {

        /**
         * Constructs a new ModeEnvelope.
         * @param [properties] Properties to set
         */
        constructor(properties?: motors_mirroring.IModeEnvelope);

        /** ModeEnvelope monotonicStampNs. */
        public monotonicStampNs: Long;

        /** ModeEnvelope localStampNs. */
        public localStampNs: Long;

        /** ModeEnvelope appStartId. */
        public appStartId: Long;

        /** ModeEnvelope bus. */
        public bus?: (motors_mirroring.IMirroringBus|null);

        /** ModeEnvelope mode. */
        public mode: motors_mirroring.BusMode;

        /**
         * Creates a new ModeEnvelope instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ModeEnvelope instance
         */
        public static create(properties?: motors_mirroring.IModeEnvelope): motors_mirroring.ModeEnvelope;

        /**
         * Encodes the specified ModeEnvelope message. Does not implicitly {@link motors_mirroring.ModeEnvelope.verify|verify} messages.
         * @param message ModeEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: motors_mirroring.IModeEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ModeEnvelope message, length delimited. Does not implicitly {@link motors_mirroring.ModeEnvelope.verify|verify} messages.
         * @param message ModeEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: motors_mirroring.IModeEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ModeEnvelope message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ModeEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): motors_mirroring.ModeEnvelope;

        /**
         * Decodes a ModeEnvelope message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ModeEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): motors_mirroring.ModeEnvelope;

        /**
         * Verifies a ModeEnvelope message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ModeEnvelope message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ModeEnvelope
         */
        public static fromObject(object: { [k: string]: any }): motors_mirroring.ModeEnvelope;

        /**
         * Creates a plain object from a ModeEnvelope message. Also converts values to other types if specified.
         * @param message ModeEnvelope
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: motors_mirroring.ModeEnvelope, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ModeEnvelope to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ModeEnvelope
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** CommandType enum. */
    enum CommandType {
        CT_START_MIRROR = 0,
        CT_STOP_MIRROR = 1
    }

    /** Properties of a Command. */
    interface ICommand {

        /** Command type */
        type?: (motors_mirroring.CommandType|null);

        /** Command source */
        source?: (motors_mirroring.IMirroringBus|null);

        /** Command targets */
        targets?: (motors_mirroring.IMirroringBus[]|null);
    }

    /** Represents a Command. */
    class Command implements ICommand {

        /**
         * Constructs a new Command.
         * @param [properties] Properties to set
         */
        constructor(properties?: motors_mirroring.ICommand);

        /** Command type. */
        public type: motors_mirroring.CommandType;

        /** Command source. */
        public source?: (motors_mirroring.IMirroringBus|null);

        /** Command targets. */
        public targets: motors_mirroring.IMirroringBus[];

        /**
         * Creates a new Command instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Command instance
         */
        public static create(properties?: motors_mirroring.ICommand): motors_mirroring.Command;

        /**
         * Encodes the specified Command message. Does not implicitly {@link motors_mirroring.Command.verify|verify} messages.
         * @param message Command message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: motors_mirroring.ICommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Command message, length delimited. Does not implicitly {@link motors_mirroring.Command.verify|verify} messages.
         * @param message Command message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: motors_mirroring.ICommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Command message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Command
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): motors_mirroring.Command;

        /**
         * Decodes a Command message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Command
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): motors_mirroring.Command;

        /**
         * Verifies a Command message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Command message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Command
         */
        public static fromObject(object: { [k: string]: any }): motors_mirroring.Command;

        /**
         * Creates a plain object from a Command message. Also converts values to other types if specified.
         * @param message Command
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: motors_mirroring.Command, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Command to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Command
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a TxEnvelope. */
    interface ITxEnvelope {

        /** TxEnvelope monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** TxEnvelope localStampNs */
        localStampNs?: (Long|null);

        /** TxEnvelope appStartId */
        appStartId?: (Long|null);

        /** TxEnvelope command */
        command?: (motors_mirroring.ICommand|null);
    }

    /** Represents a TxEnvelope. */
    class TxEnvelope implements ITxEnvelope {

        /**
         * Constructs a new TxEnvelope.
         * @param [properties] Properties to set
         */
        constructor(properties?: motors_mirroring.ITxEnvelope);

        /** TxEnvelope monotonicStampNs. */
        public monotonicStampNs: Long;

        /** TxEnvelope localStampNs. */
        public localStampNs: Long;

        /** TxEnvelope appStartId. */
        public appStartId: Long;

        /** TxEnvelope command. */
        public command?: (motors_mirroring.ICommand|null);

        /**
         * Creates a new TxEnvelope instance using the specified properties.
         * @param [properties] Properties to set
         * @returns TxEnvelope instance
         */
        public static create(properties?: motors_mirroring.ITxEnvelope): motors_mirroring.TxEnvelope;

        /**
         * Encodes the specified TxEnvelope message. Does not implicitly {@link motors_mirroring.TxEnvelope.verify|verify} messages.
         * @param message TxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: motors_mirroring.ITxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified TxEnvelope message, length delimited. Does not implicitly {@link motors_mirroring.TxEnvelope.verify|verify} messages.
         * @param message TxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: motors_mirroring.ITxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a TxEnvelope message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns TxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): motors_mirroring.TxEnvelope;

        /**
         * Decodes a TxEnvelope message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns TxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): motors_mirroring.TxEnvelope;

        /**
         * Verifies a TxEnvelope message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a TxEnvelope message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns TxEnvelope
         */
        public static fromObject(object: { [k: string]: any }): motors_mirroring.TxEnvelope;

        /**
         * Creates a plain object from a TxEnvelope message. Also converts values to other types if specified.
         * @param message TxEnvelope
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: motors_mirroring.TxEnvelope, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this TxEnvelope to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for TxEnvelope
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a RxEnvelope. */
    interface IRxEnvelope {

        /** RxEnvelope monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** RxEnvelope localStampNs */
        localStampNs?: (Long|null);

        /** RxEnvelope appStartId */
        appStartId?: (Long|null);

        /** RxEnvelope state */
        state?: (motors_mirroring.IInferenceState|null);

        /** RxEnvelope command */
        command?: (motors_mirroring.ICommand|null);

        /** RxEnvelope gravityCommand */
        gravityCommand?: (motors_mirroring.IGravityCompCommand|null);
    }

    /** Represents a RxEnvelope. */
    class RxEnvelope implements IRxEnvelope {

        /**
         * Constructs a new RxEnvelope.
         * @param [properties] Properties to set
         */
        constructor(properties?: motors_mirroring.IRxEnvelope);

        /** RxEnvelope monotonicStampNs. */
        public monotonicStampNs: Long;

        /** RxEnvelope localStampNs. */
        public localStampNs: Long;

        /** RxEnvelope appStartId. */
        public appStartId: Long;

        /** RxEnvelope state. */
        public state?: (motors_mirroring.IInferenceState|null);

        /** RxEnvelope command. */
        public command?: (motors_mirroring.ICommand|null);

        /** RxEnvelope gravityCommand. */
        public gravityCommand?: (motors_mirroring.IGravityCompCommand|null);

        /**
         * Creates a new RxEnvelope instance using the specified properties.
         * @param [properties] Properties to set
         * @returns RxEnvelope instance
         */
        public static create(properties?: motors_mirroring.IRxEnvelope): motors_mirroring.RxEnvelope;

        /**
         * Encodes the specified RxEnvelope message. Does not implicitly {@link motors_mirroring.RxEnvelope.verify|verify} messages.
         * @param message RxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: motors_mirroring.IRxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified RxEnvelope message, length delimited. Does not implicitly {@link motors_mirroring.RxEnvelope.verify|verify} messages.
         * @param message RxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: motors_mirroring.IRxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a RxEnvelope message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns RxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): motors_mirroring.RxEnvelope;

        /**
         * Decodes a RxEnvelope message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns RxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): motors_mirroring.RxEnvelope;

        /**
         * Verifies a RxEnvelope message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a RxEnvelope message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns RxEnvelope
         */
        public static fromObject(object: { [k: string]: any }): motors_mirroring.RxEnvelope;

        /**
         * Creates a plain object from a RxEnvelope message. Also converts values to other types if specified.
         * @param message RxEnvelope
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: motors_mirroring.RxEnvelope, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this RxEnvelope to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for RxEnvelope
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an InferenceState. */
    interface IInferenceState {

        /** InferenceState modes */
        modes?: (motors_mirroring.InferenceState.IBus[]|null);

        /** InferenceState mirroring */
        mirroring?: (motors_mirroring.InferenceState.IMirroring[]|null);

        /** InferenceState gravityComp */
        gravityComp?: (motors_mirroring.IGravityCompBusState[]|null);
    }

    /** Represents an InferenceState. */
    class InferenceState implements IInferenceState {

        /**
         * Constructs a new InferenceState.
         * @param [properties] Properties to set
         */
        constructor(properties?: motors_mirroring.IInferenceState);

        /** InferenceState modes. */
        public modes: motors_mirroring.InferenceState.IBus[];

        /** InferenceState mirroring. */
        public mirroring: motors_mirroring.InferenceState.IMirroring[];

        /** InferenceState gravityComp. */
        public gravityComp: motors_mirroring.IGravityCompBusState[];

        /**
         * Creates a new InferenceState instance using the specified properties.
         * @param [properties] Properties to set
         * @returns InferenceState instance
         */
        public static create(properties?: motors_mirroring.IInferenceState): motors_mirroring.InferenceState;

        /**
         * Encodes the specified InferenceState message. Does not implicitly {@link motors_mirroring.InferenceState.verify|verify} messages.
         * @param message InferenceState message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: motors_mirroring.IInferenceState, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified InferenceState message, length delimited. Does not implicitly {@link motors_mirroring.InferenceState.verify|verify} messages.
         * @param message InferenceState message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: motors_mirroring.IInferenceState, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an InferenceState message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns InferenceState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): motors_mirroring.InferenceState;

        /**
         * Decodes an InferenceState message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns InferenceState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): motors_mirroring.InferenceState;

        /**
         * Verifies an InferenceState message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an InferenceState message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns InferenceState
         */
        public static fromObject(object: { [k: string]: any }): motors_mirroring.InferenceState;

        /**
         * Creates a plain object from an InferenceState message. Also converts values to other types if specified.
         * @param message InferenceState
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: motors_mirroring.InferenceState, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this InferenceState to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for InferenceState
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    namespace InferenceState {

        /** Properties of a Bus. */
        interface IBus {

            /** Bus id */
            id?: (motors_mirroring.IMirroringBus|null);

            /** Bus mode */
            mode?: (motors_mirroring.BusMode|null);
        }

        /** Represents a Bus. */
        class Bus implements IBus {

            /**
             * Constructs a new Bus.
             * @param [properties] Properties to set
             */
            constructor(properties?: motors_mirroring.InferenceState.IBus);

            /** Bus id. */
            public id?: (motors_mirroring.IMirroringBus|null);

            /** Bus mode. */
            public mode: motors_mirroring.BusMode;

            /**
             * Creates a new Bus instance using the specified properties.
             * @param [properties] Properties to set
             * @returns Bus instance
             */
            public static create(properties?: motors_mirroring.InferenceState.IBus): motors_mirroring.InferenceState.Bus;

            /**
             * Encodes the specified Bus message. Does not implicitly {@link motors_mirroring.InferenceState.Bus.verify|verify} messages.
             * @param message Bus message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: motors_mirroring.InferenceState.IBus, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified Bus message, length delimited. Does not implicitly {@link motors_mirroring.InferenceState.Bus.verify|verify} messages.
             * @param message Bus message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: motors_mirroring.InferenceState.IBus, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a Bus message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns Bus
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): motors_mirroring.InferenceState.Bus;

            /**
             * Decodes a Bus message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns Bus
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): motors_mirroring.InferenceState.Bus;

            /**
             * Verifies a Bus message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a Bus message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns Bus
             */
            public static fromObject(object: { [k: string]: any }): motors_mirroring.InferenceState.Bus;

            /**
             * Creates a plain object from a Bus message. Also converts values to other types if specified.
             * @param message Bus
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: motors_mirroring.InferenceState.Bus, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this Bus to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for Bus
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of a Mirroring. */
        interface IMirroring {

            /** Mirroring source */
            source?: (motors_mirroring.InferenceState.IBus|null);

            /** Mirroring targets */
            targets?: (motors_mirroring.InferenceState.IBus[]|null);
        }

        /** Represents a Mirroring. */
        class Mirroring implements IMirroring {

            /**
             * Constructs a new Mirroring.
             * @param [properties] Properties to set
             */
            constructor(properties?: motors_mirroring.InferenceState.IMirroring);

            /** Mirroring source. */
            public source?: (motors_mirroring.InferenceState.IBus|null);

            /** Mirroring targets. */
            public targets: motors_mirroring.InferenceState.IBus[];

            /**
             * Creates a new Mirroring instance using the specified properties.
             * @param [properties] Properties to set
             * @returns Mirroring instance
             */
            public static create(properties?: motors_mirroring.InferenceState.IMirroring): motors_mirroring.InferenceState.Mirroring;

            /**
             * Encodes the specified Mirroring message. Does not implicitly {@link motors_mirroring.InferenceState.Mirroring.verify|verify} messages.
             * @param message Mirroring message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: motors_mirroring.InferenceState.IMirroring, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified Mirroring message, length delimited. Does not implicitly {@link motors_mirroring.InferenceState.Mirroring.verify|verify} messages.
             * @param message Mirroring message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: motors_mirroring.InferenceState.IMirroring, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a Mirroring message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns Mirroring
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): motors_mirroring.InferenceState.Mirroring;

            /**
             * Decodes a Mirroring message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns Mirroring
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): motors_mirroring.InferenceState.Mirroring;

            /**
             * Verifies a Mirroring message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a Mirroring message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns Mirroring
             */
            public static fromObject(object: { [k: string]: any }): motors_mirroring.InferenceState.Mirroring;

            /**
             * Creates a plain object from a Mirroring message. Also converts values to other types if specified.
             * @param message Mirroring
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: motors_mirroring.InferenceState.Mirroring, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this Mirroring to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for Mirroring
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }
    }

    /** GravityCompState enum. */
    enum GravityCompState {
        GC_UNKNOWN = 0,
        GC_DISABLED = 1,
        GC_ENABLED = 2
    }

    /** Properties of a GravityCompModeEnvelope. */
    interface IGravityCompModeEnvelope {

        /** GravityCompModeEnvelope monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** GravityCompModeEnvelope localStampNs */
        localStampNs?: (Long|null);

        /** GravityCompModeEnvelope appStartId */
        appStartId?: (Long|null);

        /** GravityCompModeEnvelope bus */
        bus?: (motors_mirroring.IMirroringBus|null);

        /** GravityCompModeEnvelope state */
        state?: (motors_mirroring.GravityCompState|null);
    }

    /** Represents a GravityCompModeEnvelope. */
    class GravityCompModeEnvelope implements IGravityCompModeEnvelope {

        /**
         * Constructs a new GravityCompModeEnvelope.
         * @param [properties] Properties to set
         */
        constructor(properties?: motors_mirroring.IGravityCompModeEnvelope);

        /** GravityCompModeEnvelope monotonicStampNs. */
        public monotonicStampNs: Long;

        /** GravityCompModeEnvelope localStampNs. */
        public localStampNs: Long;

        /** GravityCompModeEnvelope appStartId. */
        public appStartId: Long;

        /** GravityCompModeEnvelope bus. */
        public bus?: (motors_mirroring.IMirroringBus|null);

        /** GravityCompModeEnvelope state. */
        public state: motors_mirroring.GravityCompState;

        /**
         * Creates a new GravityCompModeEnvelope instance using the specified properties.
         * @param [properties] Properties to set
         * @returns GravityCompModeEnvelope instance
         */
        public static create(properties?: motors_mirroring.IGravityCompModeEnvelope): motors_mirroring.GravityCompModeEnvelope;

        /**
         * Encodes the specified GravityCompModeEnvelope message. Does not implicitly {@link motors_mirroring.GravityCompModeEnvelope.verify|verify} messages.
         * @param message GravityCompModeEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: motors_mirroring.IGravityCompModeEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified GravityCompModeEnvelope message, length delimited. Does not implicitly {@link motors_mirroring.GravityCompModeEnvelope.verify|verify} messages.
         * @param message GravityCompModeEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: motors_mirroring.IGravityCompModeEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a GravityCompModeEnvelope message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns GravityCompModeEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): motors_mirroring.GravityCompModeEnvelope;

        /**
         * Decodes a GravityCompModeEnvelope message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns GravityCompModeEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): motors_mirroring.GravityCompModeEnvelope;

        /**
         * Verifies a GravityCompModeEnvelope message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a GravityCompModeEnvelope message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns GravityCompModeEnvelope
         */
        public static fromObject(object: { [k: string]: any }): motors_mirroring.GravityCompModeEnvelope;

        /**
         * Creates a plain object from a GravityCompModeEnvelope message. Also converts values to other types if specified.
         * @param message GravityCompModeEnvelope
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: motors_mirroring.GravityCompModeEnvelope, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this GravityCompModeEnvelope to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for GravityCompModeEnvelope
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** GravityCompCommandType enum. */
    enum GravityCompCommandType {
        GCT_START_GRAVITY_COMP = 0,
        GCT_STOP_GRAVITY_COMP = 1,
        GCT_SET_GAIN = 2,
        GCT_SET_TORQUE_LIMIT = 3,
        GCT_SAVE_SETTINGS = 4
    }

    /** Properties of a GravityCompCommand. */
    interface IGravityCompCommand {

        /** GravityCompCommand type */
        type?: (motors_mirroring.GravityCompCommandType|null);

        /** GravityCompCommand bus */
        bus?: (motors_mirroring.IMirroringBus|null);

        /** GravityCompCommand gainRadPerNm */
        gainRadPerNm?: (number|null);

        /** GravityCompCommand motorId */
        motorId?: (number|null);

        /** GravityCompCommand torqueLimit */
        torqueLimit?: (number|null);
    }

    /** Represents a GravityCompCommand. */
    class GravityCompCommand implements IGravityCompCommand {

        /**
         * Constructs a new GravityCompCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: motors_mirroring.IGravityCompCommand);

        /** GravityCompCommand type. */
        public type: motors_mirroring.GravityCompCommandType;

        /** GravityCompCommand bus. */
        public bus?: (motors_mirroring.IMirroringBus|null);

        /** GravityCompCommand gainRadPerNm. */
        public gainRadPerNm?: (number|null);

        /** GravityCompCommand motorId. */
        public motorId?: (number|null);

        /** GravityCompCommand torqueLimit. */
        public torqueLimit?: (number|null);

        /**
         * Creates a new GravityCompCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns GravityCompCommand instance
         */
        public static create(properties?: motors_mirroring.IGravityCompCommand): motors_mirroring.GravityCompCommand;

        /**
         * Encodes the specified GravityCompCommand message. Does not implicitly {@link motors_mirroring.GravityCompCommand.verify|verify} messages.
         * @param message GravityCompCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: motors_mirroring.IGravityCompCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified GravityCompCommand message, length delimited. Does not implicitly {@link motors_mirroring.GravityCompCommand.verify|verify} messages.
         * @param message GravityCompCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: motors_mirroring.IGravityCompCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a GravityCompCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns GravityCompCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): motors_mirroring.GravityCompCommand;

        /**
         * Decodes a GravityCompCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns GravityCompCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): motors_mirroring.GravityCompCommand;

        /**
         * Verifies a GravityCompCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a GravityCompCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns GravityCompCommand
         */
        public static fromObject(object: { [k: string]: any }): motors_mirroring.GravityCompCommand;

        /**
         * Creates a plain object from a GravityCompCommand message. Also converts values to other types if specified.
         * @param message GravityCompCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: motors_mirroring.GravityCompCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this GravityCompCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for GravityCompCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a GravityCompBusState. */
    interface IGravityCompBusState {

        /** GravityCompBusState id */
        id?: (motors_mirroring.IMirroringBus|null);

        /** GravityCompBusState state */
        state?: (motors_mirroring.GravityCompState|null);

        /** GravityCompBusState jointGainsRadPerNm */
        jointGainsRadPerNm?: (number[]|null);

        /** GravityCompBusState torqueLimit */
        torqueLimit?: (number|null);
    }

    /** Represents a GravityCompBusState. */
    class GravityCompBusState implements IGravityCompBusState {

        /**
         * Constructs a new GravityCompBusState.
         * @param [properties] Properties to set
         */
        constructor(properties?: motors_mirroring.IGravityCompBusState);

        /** GravityCompBusState id. */
        public id?: (motors_mirroring.IMirroringBus|null);

        /** GravityCompBusState state. */
        public state: motors_mirroring.GravityCompState;

        /** GravityCompBusState jointGainsRadPerNm. */
        public jointGainsRadPerNm: number[];

        /** GravityCompBusState torqueLimit. */
        public torqueLimit?: (number|null);

        /**
         * Creates a new GravityCompBusState instance using the specified properties.
         * @param [properties] Properties to set
         * @returns GravityCompBusState instance
         */
        public static create(properties?: motors_mirroring.IGravityCompBusState): motors_mirroring.GravityCompBusState;

        /**
         * Encodes the specified GravityCompBusState message. Does not implicitly {@link motors_mirroring.GravityCompBusState.verify|verify} messages.
         * @param message GravityCompBusState message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: motors_mirroring.IGravityCompBusState, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified GravityCompBusState message, length delimited. Does not implicitly {@link motors_mirroring.GravityCompBusState.verify|verify} messages.
         * @param message GravityCompBusState message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: motors_mirroring.IGravityCompBusState, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a GravityCompBusState message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns GravityCompBusState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): motors_mirroring.GravityCompBusState;

        /**
         * Decodes a GravityCompBusState message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns GravityCompBusState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): motors_mirroring.GravityCompBusState;

        /**
         * Verifies a GravityCompBusState message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a GravityCompBusState message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns GravityCompBusState
         */
        public static fromObject(object: { [k: string]: any }): motors_mirroring.GravityCompBusState;

        /**
         * Creates a plain object from a GravityCompBusState message. Also converts values to other types if specified.
         * @param message GravityCompBusState
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: motors_mirroring.GravityCompBusState, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this GravityCompBusState to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for GravityCompBusState
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a GravityCompSettingsEnvelope. */
    interface IGravityCompSettingsEnvelope {

        /** GravityCompSettingsEnvelope monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** GravityCompSettingsEnvelope localStampNs */
        localStampNs?: (Long|null);

        /** GravityCompSettingsEnvelope appStartId */
        appStartId?: (Long|null);

        /** GravityCompSettingsEnvelope bus */
        bus?: (motors_mirroring.IMirroringBus|null);

        /** GravityCompSettingsEnvelope jointGainsRadPerNm */
        jointGainsRadPerNm?: (number[]|null);

        /** GravityCompSettingsEnvelope torqueLimit */
        torqueLimit?: (number|null);
    }

    /** Represents a GravityCompSettingsEnvelope. */
    class GravityCompSettingsEnvelope implements IGravityCompSettingsEnvelope {

        /**
         * Constructs a new GravityCompSettingsEnvelope.
         * @param [properties] Properties to set
         */
        constructor(properties?: motors_mirroring.IGravityCompSettingsEnvelope);

        /** GravityCompSettingsEnvelope monotonicStampNs. */
        public monotonicStampNs: Long;

        /** GravityCompSettingsEnvelope localStampNs. */
        public localStampNs: Long;

        /** GravityCompSettingsEnvelope appStartId. */
        public appStartId: Long;

        /** GravityCompSettingsEnvelope bus. */
        public bus?: (motors_mirroring.IMirroringBus|null);

        /** GravityCompSettingsEnvelope jointGainsRadPerNm. */
        public jointGainsRadPerNm: number[];

        /** GravityCompSettingsEnvelope torqueLimit. */
        public torqueLimit: number;

        /**
         * Creates a new GravityCompSettingsEnvelope instance using the specified properties.
         * @param [properties] Properties to set
         * @returns GravityCompSettingsEnvelope instance
         */
        public static create(properties?: motors_mirroring.IGravityCompSettingsEnvelope): motors_mirroring.GravityCompSettingsEnvelope;

        /**
         * Encodes the specified GravityCompSettingsEnvelope message. Does not implicitly {@link motors_mirroring.GravityCompSettingsEnvelope.verify|verify} messages.
         * @param message GravityCompSettingsEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: motors_mirroring.IGravityCompSettingsEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified GravityCompSettingsEnvelope message, length delimited. Does not implicitly {@link motors_mirroring.GravityCompSettingsEnvelope.verify|verify} messages.
         * @param message GravityCompSettingsEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: motors_mirroring.IGravityCompSettingsEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a GravityCompSettingsEnvelope message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns GravityCompSettingsEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): motors_mirroring.GravityCompSettingsEnvelope;

        /**
         * Decodes a GravityCompSettingsEnvelope message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns GravityCompSettingsEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): motors_mirroring.GravityCompSettingsEnvelope;

        /**
         * Verifies a GravityCompSettingsEnvelope message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a GravityCompSettingsEnvelope message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns GravityCompSettingsEnvelope
         */
        public static fromObject(object: { [k: string]: any }): motors_mirroring.GravityCompSettingsEnvelope;

        /**
         * Creates a plain object from a GravityCompSettingsEnvelope message. Also converts values to other types if specified.
         * @param message GravityCompSettingsEnvelope
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: motors_mirroring.GravityCompSettingsEnvelope, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this GravityCompSettingsEnvelope to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for GravityCompSettingsEnvelope
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }
}

/** Namespace yahboom_dogzilla_lite. */
export namespace yahboom_dogzilla_lite {

    /** YahboomDogzillaLiteSignalType enum. */
    enum YahboomDogzillaLiteSignalType {
        YAHBOOM_DOGZILLA_LITE_SIGNAL_TYPE_UNSPECIFIED = 0,
        YAHBOOM_DOGZILLA_LITE_CONNECTED = 1,
        YAHBOOM_DOGZILLA_LITE_DISCONNECTED = 2,
        YAHBOOM_DOGZILLA_LITE_STATUS_UPDATE = 3,
        YAHBOOM_DOGZILLA_LITE_COMMAND = 4,
        YAHBOOM_DOGZILLA_LITE_COMMAND_SUCCESS = 5,
        YAHBOOM_DOGZILLA_LITE_COMMAND_FAILED = 6,
        YAHBOOM_DOGZILLA_LITE_ERROR = 7
    }

    /** YahboomDogzillaLiteModel enum. */
    enum YahboomDogzillaLiteModel {
        YAHBOOM_DOGZILLA_LITE_MODEL_UNKNOWN = 0,
        YAHBOOM_DOGZILLA_LITE_MINI = 1,
        YAHBOOM_DOGZILLA_LITE = 2,
        YAHBOOM_DOGZILLA_LITE_PRO = 3,
        YAHBOOM_DOGZILLA_LITE_RIDER = 4
    }

    /** GaitType enum. */
    enum GaitType {
        GAIT_TROT = 0,
        GAIT_WALK = 1,
        GAIT_HIGH_WALK = 2,
        GAIT_MICRO_TROT = 3
    }

    /** PerformanceMode enum. */
    enum PerformanceMode {
        PERFORMANCE_NORMAL_CONTROL = 0,
        PERFORMANCE_CYCLE_ACTION = 1
    }

    /** ImuMode enum. */
    enum ImuMode {
        IMU_DISABLED = 0,
        IMU_SELF_STABILIZE = 1
    }

    /** ActionType enum. */
    enum ActionType {
        ACTION_UNSPECIFIED = 0,
        ACTION_LIE_DOWN = 1,
        ACTION_STAND_UP = 2,
        ACTION_CRAWL_FORWARD = 3,
        ACTION_TURN_AROUND = 4,
        ACTION_MARCH_IN_PLACE = 5,
        ACTION_SQUAT = 6,
        ACTION_ROLL = 7,
        ACTION_PITCH = 8,
        ACTION_YAW = 9,
        ACTION_THREE_AXIS_ROTATION = 10,
        ACTION_PEE = 11,
        ACTION_SIT_DOWN = 12,
        ACTION_WAVE = 13,
        ACTION_STRETCH = 14,
        ACTION_WAVE2 = 15,
        ACTION_SWAY = 16,
        ACTION_BEG_FOR_FOOD = 17,
        ACTION_FIND_FOOD = 18,
        ACTION_HANDSHAKE = 19,
        ACTION_ARM_DEMO = 20,
        ACTION_PUSHUPS = 21,
        ACTION_PITCH_YAW_ROTATION = 22,
        ACTION_UP_DOWN_ROTATION = 23,
        ACTION_FORWARD_BACKWARD_ROTATION = 24,
        ACTION_RESTORE_DEFAULT = 255
    }

    /** Properties of a YahboomDogzillaLiteDevice. */
    interface IYahboomDogzillaLiteDevice {

        /** YahboomDogzillaLiteDevice portName */
        portName?: (string|null);

        /** YahboomDogzillaLiteDevice baudRate */
        baudRate?: (number|null);

        /** YahboomDogzillaLiteDevice serialNumber */
        serialNumber?: (string|null);

        /** YahboomDogzillaLiteDevice firmwareVersion */
        firmwareVersion?: (string|null);

        /** YahboomDogzillaLiteDevice model */
        model?: (yahboom_dogzilla_lite.YahboomDogzillaLiteModel|null);

        /** YahboomDogzillaLiteDevice vid */
        vid?: (number|null);

        /** YahboomDogzillaLiteDevice pid */
        pid?: (number|null);

        /** YahboomDogzillaLiteDevice manufacturer */
        manufacturer?: (string|null);

        /** YahboomDogzillaLiteDevice product */
        product?: (string|null);
    }

    /** Represents a YahboomDogzillaLiteDevice. */
    class YahboomDogzillaLiteDevice implements IYahboomDogzillaLiteDevice {

        /**
         * Constructs a new YahboomDogzillaLiteDevice.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.IYahboomDogzillaLiteDevice);

        /** YahboomDogzillaLiteDevice portName. */
        public portName: string;

        /** YahboomDogzillaLiteDevice baudRate. */
        public baudRate: number;

        /** YahboomDogzillaLiteDevice serialNumber. */
        public serialNumber: string;

        /** YahboomDogzillaLiteDevice firmwareVersion. */
        public firmwareVersion: string;

        /** YahboomDogzillaLiteDevice model. */
        public model: yahboom_dogzilla_lite.YahboomDogzillaLiteModel;

        /** YahboomDogzillaLiteDevice vid. */
        public vid: number;

        /** YahboomDogzillaLiteDevice pid. */
        public pid: number;

        /** YahboomDogzillaLiteDevice manufacturer. */
        public manufacturer: string;

        /** YahboomDogzillaLiteDevice product. */
        public product: string;

        /**
         * Creates a new YahboomDogzillaLiteDevice instance using the specified properties.
         * @param [properties] Properties to set
         * @returns YahboomDogzillaLiteDevice instance
         */
        public static create(properties?: yahboom_dogzilla_lite.IYahboomDogzillaLiteDevice): yahboom_dogzilla_lite.YahboomDogzillaLiteDevice;

        /**
         * Encodes the specified YahboomDogzillaLiteDevice message. Does not implicitly {@link yahboom_dogzilla_lite.YahboomDogzillaLiteDevice.verify|verify} messages.
         * @param message YahboomDogzillaLiteDevice message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.IYahboomDogzillaLiteDevice, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified YahboomDogzillaLiteDevice message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.YahboomDogzillaLiteDevice.verify|verify} messages.
         * @param message YahboomDogzillaLiteDevice message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.IYahboomDogzillaLiteDevice, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a YahboomDogzillaLiteDevice message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns YahboomDogzillaLiteDevice
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.YahboomDogzillaLiteDevice;

        /**
         * Decodes a YahboomDogzillaLiteDevice message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns YahboomDogzillaLiteDevice
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.YahboomDogzillaLiteDevice;

        /**
         * Verifies a YahboomDogzillaLiteDevice message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a YahboomDogzillaLiteDevice message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns YahboomDogzillaLiteDevice
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.YahboomDogzillaLiteDevice;

        /**
         * Creates a plain object from a YahboomDogzillaLiteDevice message. Also converts values to other types if specified.
         * @param message YahboomDogzillaLiteDevice
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.YahboomDogzillaLiteDevice, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this YahboomDogzillaLiteDevice to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for YahboomDogzillaLiteDevice
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an ImuOrientation. */
    interface IImuOrientation {

        /** ImuOrientation roll */
        roll?: (number|null);

        /** ImuOrientation pitch */
        pitch?: (number|null);

        /** ImuOrientation yaw */
        yaw?: (number|null);
    }

    /** Represents an ImuOrientation. */
    class ImuOrientation implements IImuOrientation {

        /**
         * Constructs a new ImuOrientation.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.IImuOrientation);

        /** ImuOrientation roll. */
        public roll: number;

        /** ImuOrientation pitch. */
        public pitch: number;

        /** ImuOrientation yaw. */
        public yaw: number;

        /**
         * Creates a new ImuOrientation instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ImuOrientation instance
         */
        public static create(properties?: yahboom_dogzilla_lite.IImuOrientation): yahboom_dogzilla_lite.ImuOrientation;

        /**
         * Encodes the specified ImuOrientation message. Does not implicitly {@link yahboom_dogzilla_lite.ImuOrientation.verify|verify} messages.
         * @param message ImuOrientation message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.IImuOrientation, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ImuOrientation message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.ImuOrientation.verify|verify} messages.
         * @param message ImuOrientation message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.IImuOrientation, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an ImuOrientation message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ImuOrientation
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.ImuOrientation;

        /**
         * Decodes an ImuOrientation message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ImuOrientation
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.ImuOrientation;

        /**
         * Verifies an ImuOrientation message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an ImuOrientation message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ImuOrientation
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.ImuOrientation;

        /**
         * Creates a plain object from an ImuOrientation message. Also converts values to other types if specified.
         * @param message ImuOrientation
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.ImuOrientation, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ImuOrientation to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ImuOrientation
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an Acceleration. */
    interface IAcceleration {

        /** Acceleration x */
        x?: (number|null);

        /** Acceleration y */
        y?: (number|null);

        /** Acceleration z */
        z?: (number|null);
    }

    /** Represents an Acceleration. */
    class Acceleration implements IAcceleration {

        /**
         * Constructs a new Acceleration.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.IAcceleration);

        /** Acceleration x. */
        public x: number;

        /** Acceleration y. */
        public y: number;

        /** Acceleration z. */
        public z: number;

        /**
         * Creates a new Acceleration instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Acceleration instance
         */
        public static create(properties?: yahboom_dogzilla_lite.IAcceleration): yahboom_dogzilla_lite.Acceleration;

        /**
         * Encodes the specified Acceleration message. Does not implicitly {@link yahboom_dogzilla_lite.Acceleration.verify|verify} messages.
         * @param message Acceleration message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.IAcceleration, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Acceleration message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.Acceleration.verify|verify} messages.
         * @param message Acceleration message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.IAcceleration, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an Acceleration message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Acceleration
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.Acceleration;

        /**
         * Decodes an Acceleration message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Acceleration
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.Acceleration;

        /**
         * Verifies an Acceleration message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an Acceleration message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Acceleration
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.Acceleration;

        /**
         * Creates a plain object from an Acceleration message. Also converts values to other types if specified.
         * @param message Acceleration
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.Acceleration, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Acceleration to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Acceleration
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a YahboomDogzillaLiteStatus. */
    interface IYahboomDogzillaLiteStatus {

        /** YahboomDogzillaLiteStatus batteryLevel */
        batteryLevel?: (number|null);

        /** YahboomDogzillaLiteStatus model */
        model?: (yahboom_dogzilla_lite.YahboomDogzillaLiteModel|null);

        /** YahboomDogzillaLiteStatus firmwareVersion */
        firmwareVersion?: (string|null);

        /** YahboomDogzillaLiteStatus servoPositions */
        servoPositions?: (number[]|null);

        /** YahboomDogzillaLiteStatus orientation */
        orientation?: (yahboom_dogzilla_lite.IImuOrientation|null);

        /** YahboomDogzillaLiteStatus acceleration */
        acceleration?: (yahboom_dogzilla_lite.IAcceleration|null);

        /** YahboomDogzillaLiteStatus legServoSpeed */
        legServoSpeed?: (number|null);

        /** YahboomDogzillaLiteStatus armServoSpeed */
        armServoSpeed?: (number|null);

        /** YahboomDogzillaLiteStatus servoAngles */
        servoAngles?: (number[]|null);
    }

    /** Represents a YahboomDogzillaLiteStatus. */
    class YahboomDogzillaLiteStatus implements IYahboomDogzillaLiteStatus {

        /**
         * Constructs a new YahboomDogzillaLiteStatus.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.IYahboomDogzillaLiteStatus);

        /** YahboomDogzillaLiteStatus batteryLevel. */
        public batteryLevel: number;

        /** YahboomDogzillaLiteStatus model. */
        public model: yahboom_dogzilla_lite.YahboomDogzillaLiteModel;

        /** YahboomDogzillaLiteStatus firmwareVersion. */
        public firmwareVersion: string;

        /** YahboomDogzillaLiteStatus servoPositions. */
        public servoPositions: number[];

        /** YahboomDogzillaLiteStatus orientation. */
        public orientation?: (yahboom_dogzilla_lite.IImuOrientation|null);

        /** YahboomDogzillaLiteStatus acceleration. */
        public acceleration?: (yahboom_dogzilla_lite.IAcceleration|null);

        /** YahboomDogzillaLiteStatus legServoSpeed. */
        public legServoSpeed: number;

        /** YahboomDogzillaLiteStatus armServoSpeed. */
        public armServoSpeed: number;

        /** YahboomDogzillaLiteStatus servoAngles. */
        public servoAngles: number[];

        /**
         * Creates a new YahboomDogzillaLiteStatus instance using the specified properties.
         * @param [properties] Properties to set
         * @returns YahboomDogzillaLiteStatus instance
         */
        public static create(properties?: yahboom_dogzilla_lite.IYahboomDogzillaLiteStatus): yahboom_dogzilla_lite.YahboomDogzillaLiteStatus;

        /**
         * Encodes the specified YahboomDogzillaLiteStatus message. Does not implicitly {@link yahboom_dogzilla_lite.YahboomDogzillaLiteStatus.verify|verify} messages.
         * @param message YahboomDogzillaLiteStatus message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.IYahboomDogzillaLiteStatus, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified YahboomDogzillaLiteStatus message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.YahboomDogzillaLiteStatus.verify|verify} messages.
         * @param message YahboomDogzillaLiteStatus message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.IYahboomDogzillaLiteStatus, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a YahboomDogzillaLiteStatus message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns YahboomDogzillaLiteStatus
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.YahboomDogzillaLiteStatus;

        /**
         * Decodes a YahboomDogzillaLiteStatus message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns YahboomDogzillaLiteStatus
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.YahboomDogzillaLiteStatus;

        /**
         * Verifies a YahboomDogzillaLiteStatus message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a YahboomDogzillaLiteStatus message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns YahboomDogzillaLiteStatus
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.YahboomDogzillaLiteStatus;

        /**
         * Creates a plain object from a YahboomDogzillaLiteStatus message. Also converts values to other types if specified.
         * @param message YahboomDogzillaLiteStatus
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.YahboomDogzillaLiteStatus, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this YahboomDogzillaLiteStatus to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for YahboomDogzillaLiteStatus
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ServoCommand. */
    interface IServoCommand {

        /** ServoCommand servoId */
        servoId?: (number|null);

        /** ServoCommand position */
        position?: (number|null);
    }

    /** Represents a ServoCommand. */
    class ServoCommand implements IServoCommand {

        /**
         * Constructs a new ServoCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.IServoCommand);

        /** ServoCommand servoId. */
        public servoId: number;

        /** ServoCommand position. */
        public position: number;

        /**
         * Creates a new ServoCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ServoCommand instance
         */
        public static create(properties?: yahboom_dogzilla_lite.IServoCommand): yahboom_dogzilla_lite.ServoCommand;

        /**
         * Encodes the specified ServoCommand message. Does not implicitly {@link yahboom_dogzilla_lite.ServoCommand.verify|verify} messages.
         * @param message ServoCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.IServoCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ServoCommand message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.ServoCommand.verify|verify} messages.
         * @param message ServoCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.IServoCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ServoCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ServoCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.ServoCommand;

        /**
         * Decodes a ServoCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ServoCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.ServoCommand;

        /**
         * Verifies a ServoCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ServoCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ServoCommand
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.ServoCommand;

        /**
         * Creates a plain object from a ServoCommand message. Also converts values to other types if specified.
         * @param message ServoCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.ServoCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ServoCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ServoCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ServoSpeedCommand. */
    interface IServoSpeedCommand {

        /** ServoSpeedCommand bodyServoSpeed */
        bodyServoSpeed?: (number|null);

        /** ServoSpeedCommand armServoSpeed */
        armServoSpeed?: (number|null);
    }

    /** Represents a ServoSpeedCommand. */
    class ServoSpeedCommand implements IServoSpeedCommand {

        /**
         * Constructs a new ServoSpeedCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.IServoSpeedCommand);

        /** ServoSpeedCommand bodyServoSpeed. */
        public bodyServoSpeed?: (number|null);

        /** ServoSpeedCommand armServoSpeed. */
        public armServoSpeed?: (number|null);

        /** ServoSpeedCommand bodySpeed. */
        public bodySpeed?: "bodyServoSpeed";

        /** ServoSpeedCommand armSpeed. */
        public armSpeed?: "armServoSpeed";

        /**
         * Creates a new ServoSpeedCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ServoSpeedCommand instance
         */
        public static create(properties?: yahboom_dogzilla_lite.IServoSpeedCommand): yahboom_dogzilla_lite.ServoSpeedCommand;

        /**
         * Encodes the specified ServoSpeedCommand message. Does not implicitly {@link yahboom_dogzilla_lite.ServoSpeedCommand.verify|verify} messages.
         * @param message ServoSpeedCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.IServoSpeedCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ServoSpeedCommand message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.ServoSpeedCommand.verify|verify} messages.
         * @param message ServoSpeedCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.IServoSpeedCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ServoSpeedCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ServoSpeedCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.ServoSpeedCommand;

        /**
         * Decodes a ServoSpeedCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ServoSpeedCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.ServoSpeedCommand;

        /**
         * Verifies a ServoSpeedCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ServoSpeedCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ServoSpeedCommand
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.ServoSpeedCommand;

        /**
         * Creates a plain object from a ServoSpeedCommand message. Also converts values to other types if specified.
         * @param message ServoSpeedCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.ServoSpeedCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ServoSpeedCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ServoSpeedCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a CalibrationCommand. */
    interface ICalibrationCommand {

        /** CalibrationCommand enterCalibrationMode */
        enterCalibrationMode?: (boolean|null);

        /** CalibrationCommand setOrigin */
        setOrigin?: (boolean|null);

        /** CalibrationCommand servoCentering */
        servoCentering?: (boolean|null);

        /** CalibrationCommand gyroCalibration */
        gyroCalibration?: (boolean|null);
    }

    /** Represents a CalibrationCommand. */
    class CalibrationCommand implements ICalibrationCommand {

        /**
         * Constructs a new CalibrationCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.ICalibrationCommand);

        /** CalibrationCommand enterCalibrationMode. */
        public enterCalibrationMode: boolean;

        /** CalibrationCommand setOrigin. */
        public setOrigin: boolean;

        /** CalibrationCommand servoCentering. */
        public servoCentering: boolean;

        /** CalibrationCommand gyroCalibration. */
        public gyroCalibration: boolean;

        /**
         * Creates a new CalibrationCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns CalibrationCommand instance
         */
        public static create(properties?: yahboom_dogzilla_lite.ICalibrationCommand): yahboom_dogzilla_lite.CalibrationCommand;

        /**
         * Encodes the specified CalibrationCommand message. Does not implicitly {@link yahboom_dogzilla_lite.CalibrationCommand.verify|verify} messages.
         * @param message CalibrationCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.ICalibrationCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified CalibrationCommand message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.CalibrationCommand.verify|verify} messages.
         * @param message CalibrationCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.ICalibrationCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a CalibrationCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns CalibrationCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.CalibrationCommand;

        /**
         * Decodes a CalibrationCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns CalibrationCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.CalibrationCommand;

        /**
         * Verifies a CalibrationCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a CalibrationCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns CalibrationCommand
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.CalibrationCommand;

        /**
         * Creates a plain object from a CalibrationCommand message. Also converts values to other types if specified.
         * @param message CalibrationCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.CalibrationCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this CalibrationCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for CalibrationCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an ArmCommand. */
    interface IArmCommand {

        /** ArmCommand gripperStatus */
        gripperStatus?: (number|null);

        /** ArmCommand gripperX */
        gripperX?: (number|null);

        /** ArmCommand gripperZ */
        gripperZ?: (number|null);

        /** ArmCommand polarAngle */
        polarAngle?: (number|null);

        /** ArmCommand polarRadius */
        polarRadius?: (number|null);

        /** ArmCommand stabilityMode */
        stabilityMode?: (boolean|null);
    }

    /** Represents an ArmCommand. */
    class ArmCommand implements IArmCommand {

        /**
         * Constructs a new ArmCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.IArmCommand);

        /** ArmCommand gripperStatus. */
        public gripperStatus: number;

        /** ArmCommand gripperX. */
        public gripperX: number;

        /** ArmCommand gripperZ. */
        public gripperZ: number;

        /** ArmCommand polarAngle. */
        public polarAngle: number;

        /** ArmCommand polarRadius. */
        public polarRadius: number;

        /** ArmCommand stabilityMode. */
        public stabilityMode: boolean;

        /**
         * Creates a new ArmCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ArmCommand instance
         */
        public static create(properties?: yahboom_dogzilla_lite.IArmCommand): yahboom_dogzilla_lite.ArmCommand;

        /**
         * Encodes the specified ArmCommand message. Does not implicitly {@link yahboom_dogzilla_lite.ArmCommand.verify|verify} messages.
         * @param message ArmCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.IArmCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ArmCommand message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.ArmCommand.verify|verify} messages.
         * @param message ArmCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.IArmCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an ArmCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ArmCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.ArmCommand;

        /**
         * Decodes an ArmCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ArmCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.ArmCommand;

        /**
         * Verifies an ArmCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an ArmCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ArmCommand
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.ArmCommand;

        /**
         * Creates a plain object from an ArmCommand message. Also converts values to other types if specified.
         * @param message ArmCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.ArmCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ArmCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ArmCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an IoCommand. */
    interface IIoCommand {

        /** IoCommand power_5vOutput */
        power_5vOutput?: (boolean|null);

        /** IoCommand digitalIo */
        digitalIo?: (boolean|null);
    }

    /** Represents an IoCommand. */
    class IoCommand implements IIoCommand {

        /**
         * Constructs a new IoCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.IIoCommand);

        /** IoCommand power_5vOutput. */
        public power_5vOutput: boolean;

        /** IoCommand digitalIo. */
        public digitalIo: boolean;

        /**
         * Creates a new IoCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns IoCommand instance
         */
        public static create(properties?: yahboom_dogzilla_lite.IIoCommand): yahboom_dogzilla_lite.IoCommand;

        /**
         * Encodes the specified IoCommand message. Does not implicitly {@link yahboom_dogzilla_lite.IoCommand.verify|verify} messages.
         * @param message IoCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.IIoCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified IoCommand message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.IoCommand.verify|verify} messages.
         * @param message IoCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.IIoCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an IoCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns IoCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.IoCommand;

        /**
         * Decodes an IoCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns IoCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.IoCommand;

        /**
         * Verifies an IoCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an IoCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns IoCommand
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.IoCommand;

        /**
         * Creates a plain object from an IoCommand message. Also converts values to other types if specified.
         * @param message IoCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.IoCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this IoCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for IoCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a LedCommand. */
    interface ILedCommand {

        /** LedCommand ledIndex */
        ledIndex?: (number|null);

        /** LedCommand rgbBytes */
        rgbBytes?: (Uint8Array|null);
    }

    /** Represents a LedCommand. */
    class LedCommand implements ILedCommand {

        /**
         * Constructs a new LedCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.ILedCommand);

        /** LedCommand ledIndex. */
        public ledIndex: number;

        /** LedCommand rgbBytes. */
        public rgbBytes: Uint8Array;

        /**
         * Creates a new LedCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns LedCommand instance
         */
        public static create(properties?: yahboom_dogzilla_lite.ILedCommand): yahboom_dogzilla_lite.LedCommand;

        /**
         * Encodes the specified LedCommand message. Does not implicitly {@link yahboom_dogzilla_lite.LedCommand.verify|verify} messages.
         * @param message LedCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.ILedCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified LedCommand message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.LedCommand.verify|verify} messages.
         * @param message LedCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.ILedCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a LedCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns LedCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.LedCommand;

        /**
         * Decodes a LedCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns LedCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.LedCommand;

        /**
         * Verifies a LedCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a LedCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns LedCommand
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.LedCommand;

        /**
         * Creates a plain object from a LedCommand message. Also converts values to other types if specified.
         * @param message LedCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.LedCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this LedCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for LedCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an ActionCommand. */
    interface IActionCommand {

        /** ActionCommand action */
        action?: (yahboom_dogzilla_lite.ActionType|null);
    }

    /** Represents an ActionCommand. */
    class ActionCommand implements IActionCommand {

        /**
         * Constructs a new ActionCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.IActionCommand);

        /** ActionCommand action. */
        public action: yahboom_dogzilla_lite.ActionType;

        /**
         * Creates a new ActionCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ActionCommand instance
         */
        public static create(properties?: yahboom_dogzilla_lite.IActionCommand): yahboom_dogzilla_lite.ActionCommand;

        /**
         * Encodes the specified ActionCommand message. Does not implicitly {@link yahboom_dogzilla_lite.ActionCommand.verify|verify} messages.
         * @param message ActionCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.IActionCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ActionCommand message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.ActionCommand.verify|verify} messages.
         * @param message ActionCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.IActionCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an ActionCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ActionCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.ActionCommand;

        /**
         * Decodes an ActionCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ActionCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.ActionCommand;

        /**
         * Verifies an ActionCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an ActionCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ActionCommand
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.ActionCommand;

        /**
         * Creates a plain object from an ActionCommand message. Also converts values to other types if specified.
         * @param message ActionCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.ActionCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ActionCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ActionCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a MovementCommand. */
    interface IMovementCommand {

        /** MovementCommand moveX */
        moveX?: (number|null);

        /** MovementCommand moveY */
        moveY?: (number|null);

        /** MovementCommand moveYaw */
        moveYaw?: (number|null);
    }

    /** Represents a MovementCommand. */
    class MovementCommand implements IMovementCommand {

        /**
         * Constructs a new MovementCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.IMovementCommand);

        /** MovementCommand moveX. */
        public moveX: number;

        /** MovementCommand moveY. */
        public moveY: number;

        /** MovementCommand moveYaw. */
        public moveYaw: number;

        /**
         * Creates a new MovementCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns MovementCommand instance
         */
        public static create(properties?: yahboom_dogzilla_lite.IMovementCommand): yahboom_dogzilla_lite.MovementCommand;

        /**
         * Encodes the specified MovementCommand message. Does not implicitly {@link yahboom_dogzilla_lite.MovementCommand.verify|verify} messages.
         * @param message MovementCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.IMovementCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified MovementCommand message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.MovementCommand.verify|verify} messages.
         * @param message MovementCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.IMovementCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a MovementCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns MovementCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.MovementCommand;

        /**
         * Decodes a MovementCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns MovementCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.MovementCommand;

        /**
         * Verifies a MovementCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a MovementCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns MovementCommand
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.MovementCommand;

        /**
         * Creates a plain object from a MovementCommand message. Also converts values to other types if specified.
         * @param message MovementCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.MovementCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this MovementCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for MovementCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ConfigCommand. */
    interface IConfigCommand {

        /** ConfigCommand performanceMode */
        performanceMode?: (yahboom_dogzilla_lite.PerformanceMode|null);

        /** ConfigCommand gait */
        gait?: (yahboom_dogzilla_lite.GaitType|null);

        /** ConfigCommand imuMode */
        imuMode?: (yahboom_dogzilla_lite.ImuMode|null);

        /** ConfigCommand enableFeedback */
        enableFeedback?: (boolean|null);

        /** ConfigCommand bluetoothName */
        bluetoothName?: (string|null);
    }

    /** Represents a ConfigCommand. */
    class ConfigCommand implements IConfigCommand {

        /**
         * Constructs a new ConfigCommand.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.IConfigCommand);

        /** ConfigCommand performanceMode. */
        public performanceMode: yahboom_dogzilla_lite.PerformanceMode;

        /** ConfigCommand gait. */
        public gait: yahboom_dogzilla_lite.GaitType;

        /** ConfigCommand imuMode. */
        public imuMode: yahboom_dogzilla_lite.ImuMode;

        /** ConfigCommand enableFeedback. */
        public enableFeedback: boolean;

        /** ConfigCommand bluetoothName. */
        public bluetoothName: string;

        /**
         * Creates a new ConfigCommand instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ConfigCommand instance
         */
        public static create(properties?: yahboom_dogzilla_lite.IConfigCommand): yahboom_dogzilla_lite.ConfigCommand;

        /**
         * Encodes the specified ConfigCommand message. Does not implicitly {@link yahboom_dogzilla_lite.ConfigCommand.verify|verify} messages.
         * @param message ConfigCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.IConfigCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ConfigCommand message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.ConfigCommand.verify|verify} messages.
         * @param message ConfigCommand message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.IConfigCommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ConfigCommand message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ConfigCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.ConfigCommand;

        /**
         * Decodes a ConfigCommand message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ConfigCommand
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.ConfigCommand;

        /**
         * Verifies a ConfigCommand message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ConfigCommand message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ConfigCommand
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.ConfigCommand;

        /**
         * Creates a plain object from a ConfigCommand message. Also converts values to other types if specified.
         * @param message ConfigCommand
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.ConfigCommand, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ConfigCommand to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ConfigCommand
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a Command. */
    interface ICommand {

        /** Command targetDeviceSerial */
        targetDeviceSerial?: (string|null);

        /** Command servo */
        servo?: (yahboom_dogzilla_lite.IServoCommand|null);

        /** Command servoSpeed */
        servoSpeed?: (yahboom_dogzilla_lite.IServoSpeedCommand|null);

        /** Command calibration */
        calibration?: (yahboom_dogzilla_lite.ICalibrationCommand|null);

        /** Command arm */
        arm?: (yahboom_dogzilla_lite.IArmCommand|null);

        /** Command io */
        io?: (yahboom_dogzilla_lite.IIoCommand|null);

        /** Command config */
        config?: (yahboom_dogzilla_lite.IConfigCommand|null);

        /** Command led */
        led?: (yahboom_dogzilla_lite.ILedCommand|null);

        /** Command action */
        action?: (yahboom_dogzilla_lite.IActionCommand|null);

        /** Command movement */
        movement?: (yahboom_dogzilla_lite.IMovementCommand|null);
    }

    /** Represents a Command. */
    class Command implements ICommand {

        /**
         * Constructs a new Command.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.ICommand);

        /** Command targetDeviceSerial. */
        public targetDeviceSerial: string;

        /** Command servo. */
        public servo?: (yahboom_dogzilla_lite.IServoCommand|null);

        /** Command servoSpeed. */
        public servoSpeed?: (yahboom_dogzilla_lite.IServoSpeedCommand|null);

        /** Command calibration. */
        public calibration?: (yahboom_dogzilla_lite.ICalibrationCommand|null);

        /** Command arm. */
        public arm?: (yahboom_dogzilla_lite.IArmCommand|null);

        /** Command io. */
        public io?: (yahboom_dogzilla_lite.IIoCommand|null);

        /** Command config. */
        public config?: (yahboom_dogzilla_lite.IConfigCommand|null);

        /** Command led. */
        public led?: (yahboom_dogzilla_lite.ILedCommand|null);

        /** Command action. */
        public action?: (yahboom_dogzilla_lite.IActionCommand|null);

        /** Command movement. */
        public movement?: (yahboom_dogzilla_lite.IMovementCommand|null);

        /**
         * Creates a new Command instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Command instance
         */
        public static create(properties?: yahboom_dogzilla_lite.ICommand): yahboom_dogzilla_lite.Command;

        /**
         * Encodes the specified Command message. Does not implicitly {@link yahboom_dogzilla_lite.Command.verify|verify} messages.
         * @param message Command message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.ICommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Command message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.Command.verify|verify} messages.
         * @param message Command message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.ICommand, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Command message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Command
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.Command;

        /**
         * Decodes a Command message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Command
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.Command;

        /**
         * Verifies a Command message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Command message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Command
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.Command;

        /**
         * Creates a plain object from a Command message. Also converts values to other types if specified.
         * @param message Command
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.Command, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Command to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Command
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a TxEnvelope. */
    interface ITxEnvelope {

        /** TxEnvelope monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** TxEnvelope localStampNs */
        localStampNs?: (Long|null);

        /** TxEnvelope appStartId */
        appStartId?: (Long|null);

        /** TxEnvelope commandId */
        commandId?: (Uint8Array|null);

        /** TxEnvelope targetDeviceSerial */
        targetDeviceSerial?: (string|null);

        /** TxEnvelope command */
        command?: (yahboom_dogzilla_lite.ICommand|null);
    }

    /** Represents a TxEnvelope. */
    class TxEnvelope implements ITxEnvelope {

        /**
         * Constructs a new TxEnvelope.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.ITxEnvelope);

        /** TxEnvelope monotonicStampNs. */
        public monotonicStampNs: Long;

        /** TxEnvelope localStampNs. */
        public localStampNs: Long;

        /** TxEnvelope appStartId. */
        public appStartId: Long;

        /** TxEnvelope commandId. */
        public commandId: Uint8Array;

        /** TxEnvelope targetDeviceSerial. */
        public targetDeviceSerial: string;

        /** TxEnvelope command. */
        public command?: (yahboom_dogzilla_lite.ICommand|null);

        /**
         * Creates a new TxEnvelope instance using the specified properties.
         * @param [properties] Properties to set
         * @returns TxEnvelope instance
         */
        public static create(properties?: yahboom_dogzilla_lite.ITxEnvelope): yahboom_dogzilla_lite.TxEnvelope;

        /**
         * Encodes the specified TxEnvelope message. Does not implicitly {@link yahboom_dogzilla_lite.TxEnvelope.verify|verify} messages.
         * @param message TxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.ITxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified TxEnvelope message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.TxEnvelope.verify|verify} messages.
         * @param message TxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.ITxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a TxEnvelope message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns TxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.TxEnvelope;

        /**
         * Decodes a TxEnvelope message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns TxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.TxEnvelope;

        /**
         * Verifies a TxEnvelope message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a TxEnvelope message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns TxEnvelope
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.TxEnvelope;

        /**
         * Creates a plain object from a TxEnvelope message. Also converts values to other types if specified.
         * @param message TxEnvelope
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.TxEnvelope, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this TxEnvelope to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for TxEnvelope
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a RxEnvelope. */
    interface IRxEnvelope {

        /** RxEnvelope monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** RxEnvelope localStampNs */
        localStampNs?: (Long|null);

        /** RxEnvelope appStartId */
        appStartId?: (Long|null);

        /** RxEnvelope signalType */
        signalType?: (yahboom_dogzilla_lite.YahboomDogzillaLiteSignalType|null);

        /** RxEnvelope device */
        device?: (yahboom_dogzilla_lite.IYahboomDogzillaLiteDevice|null);

        /** RxEnvelope status */
        status?: (yahboom_dogzilla_lite.IYahboomDogzillaLiteStatus|null);

        /** RxEnvelope data */
        data?: (Uint8Array|null);

        /** RxEnvelope command */
        command?: (yahboom_dogzilla_lite.ITxEnvelope|null);

        /** RxEnvelope errorMessage */
        errorMessage?: (string|null);
    }

    /** Represents a RxEnvelope. */
    class RxEnvelope implements IRxEnvelope {

        /**
         * Constructs a new RxEnvelope.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.IRxEnvelope);

        /** RxEnvelope monotonicStampNs. */
        public monotonicStampNs: Long;

        /** RxEnvelope localStampNs. */
        public localStampNs: Long;

        /** RxEnvelope appStartId. */
        public appStartId: Long;

        /** RxEnvelope signalType. */
        public signalType: yahboom_dogzilla_lite.YahboomDogzillaLiteSignalType;

        /** RxEnvelope device. */
        public device?: (yahboom_dogzilla_lite.IYahboomDogzillaLiteDevice|null);

        /** RxEnvelope status. */
        public status?: (yahboom_dogzilla_lite.IYahboomDogzillaLiteStatus|null);

        /** RxEnvelope data. */
        public data: Uint8Array;

        /** RxEnvelope command. */
        public command?: (yahboom_dogzilla_lite.ITxEnvelope|null);

        /** RxEnvelope errorMessage. */
        public errorMessage: string;

        /**
         * Creates a new RxEnvelope instance using the specified properties.
         * @param [properties] Properties to set
         * @returns RxEnvelope instance
         */
        public static create(properties?: yahboom_dogzilla_lite.IRxEnvelope): yahboom_dogzilla_lite.RxEnvelope;

        /**
         * Encodes the specified RxEnvelope message. Does not implicitly {@link yahboom_dogzilla_lite.RxEnvelope.verify|verify} messages.
         * @param message RxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.IRxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified RxEnvelope message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.RxEnvelope.verify|verify} messages.
         * @param message RxEnvelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.IRxEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a RxEnvelope message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns RxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.RxEnvelope;

        /**
         * Decodes a RxEnvelope message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns RxEnvelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.RxEnvelope;

        /**
         * Verifies a RxEnvelope message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a RxEnvelope message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns RxEnvelope
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.RxEnvelope;

        /**
         * Creates a plain object from a RxEnvelope message. Also converts values to other types if specified.
         * @param message RxEnvelope
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.RxEnvelope, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this RxEnvelope to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for RxEnvelope
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an InferenceState. */
    interface IInferenceState {

        /** InferenceState lastInferenceQueuePtr */
        lastInferenceQueuePtr?: (Uint8Array|null);

        /** InferenceState devices */
        devices?: (yahboom_dogzilla_lite.InferenceState.IDeviceState[]|null);
    }

    /** Represents an InferenceState. */
    class InferenceState implements IInferenceState {

        /**
         * Constructs a new InferenceState.
         * @param [properties] Properties to set
         */
        constructor(properties?: yahboom_dogzilla_lite.IInferenceState);

        /** InferenceState lastInferenceQueuePtr. */
        public lastInferenceQueuePtr: Uint8Array;

        /** InferenceState devices. */
        public devices: yahboom_dogzilla_lite.InferenceState.IDeviceState[];

        /**
         * Creates a new InferenceState instance using the specified properties.
         * @param [properties] Properties to set
         * @returns InferenceState instance
         */
        public static create(properties?: yahboom_dogzilla_lite.IInferenceState): yahboom_dogzilla_lite.InferenceState;

        /**
         * Encodes the specified InferenceState message. Does not implicitly {@link yahboom_dogzilla_lite.InferenceState.verify|verify} messages.
         * @param message InferenceState message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: yahboom_dogzilla_lite.IInferenceState, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified InferenceState message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.InferenceState.verify|verify} messages.
         * @param message InferenceState message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: yahboom_dogzilla_lite.IInferenceState, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an InferenceState message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns InferenceState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.InferenceState;

        /**
         * Decodes an InferenceState message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns InferenceState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.InferenceState;

        /**
         * Verifies an InferenceState message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an InferenceState message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns InferenceState
         */
        public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.InferenceState;

        /**
         * Creates a plain object from an InferenceState message. Also converts values to other types if specified.
         * @param message InferenceState
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: yahboom_dogzilla_lite.InferenceState, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this InferenceState to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for InferenceState
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    namespace InferenceState {

        /** Properties of a DeviceState. */
        interface IDeviceState {

            /** DeviceState device */
            device?: (yahboom_dogzilla_lite.IYahboomDogzillaLiteDevice|null);

            /** DeviceState status */
            status?: (yahboom_dogzilla_lite.IYahboomDogzillaLiteStatus|null);

            /** DeviceState monotonicStampNs */
            monotonicStampNs?: (Long|null);

            /** DeviceState systemStampNs */
            systemStampNs?: (Long|null);

            /** DeviceState isConnected */
            isConnected?: (boolean|null);
        }

        /** Represents a DeviceState. */
        class DeviceState implements IDeviceState {

            /**
             * Constructs a new DeviceState.
             * @param [properties] Properties to set
             */
            constructor(properties?: yahboom_dogzilla_lite.InferenceState.IDeviceState);

            /** DeviceState device. */
            public device?: (yahboom_dogzilla_lite.IYahboomDogzillaLiteDevice|null);

            /** DeviceState status. */
            public status?: (yahboom_dogzilla_lite.IYahboomDogzillaLiteStatus|null);

            /** DeviceState monotonicStampNs. */
            public monotonicStampNs: Long;

            /** DeviceState systemStampNs. */
            public systemStampNs: Long;

            /** DeviceState isConnected. */
            public isConnected: boolean;

            /**
             * Creates a new DeviceState instance using the specified properties.
             * @param [properties] Properties to set
             * @returns DeviceState instance
             */
            public static create(properties?: yahboom_dogzilla_lite.InferenceState.IDeviceState): yahboom_dogzilla_lite.InferenceState.DeviceState;

            /**
             * Encodes the specified DeviceState message. Does not implicitly {@link yahboom_dogzilla_lite.InferenceState.DeviceState.verify|verify} messages.
             * @param message DeviceState message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: yahboom_dogzilla_lite.InferenceState.IDeviceState, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified DeviceState message, length delimited. Does not implicitly {@link yahboom_dogzilla_lite.InferenceState.DeviceState.verify|verify} messages.
             * @param message DeviceState message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: yahboom_dogzilla_lite.InferenceState.IDeviceState, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a DeviceState message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns DeviceState
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): yahboom_dogzilla_lite.InferenceState.DeviceState;

            /**
             * Decodes a DeviceState message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns DeviceState
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): yahboom_dogzilla_lite.InferenceState.DeviceState;

            /**
             * Verifies a DeviceState message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a DeviceState message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns DeviceState
             */
            public static fromObject(object: { [k: string]: any }): yahboom_dogzilla_lite.InferenceState.DeviceState;

            /**
             * Creates a plain object from a DeviceState message. Also converts values to other types if specified.
             * @param message DeviceState
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: yahboom_dogzilla_lite.InferenceState.DeviceState, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this DeviceState to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for DeviceState
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }
    }

    /** CommandResult enum. */
    enum CommandResult {
        CR_PROCESSING = 0,
        CR_SUCCESS = 1,
        CR_FAILED = 2
    }
}

/** Namespace sysinfo. */
export namespace sysinfo {

    /** Properties of an Envelope. */
    interface IEnvelope {

        /** Envelope monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** Envelope localStampNs */
        localStampNs?: (Long|null);

        /** Envelope appStartId */
        appStartId?: (Long|null);

        /** Envelope data */
        data?: (sysinfo.IEnvelopeData|null);
    }

    /** Represents an Envelope. */
    class Envelope implements IEnvelope {

        /**
         * Constructs a new Envelope.
         * @param [properties] Properties to set
         */
        constructor(properties?: sysinfo.IEnvelope);

        /** Envelope monotonicStampNs. */
        public monotonicStampNs: Long;

        /** Envelope localStampNs. */
        public localStampNs: Long;

        /** Envelope appStartId. */
        public appStartId: Long;

        /** Envelope data. */
        public data?: (sysinfo.IEnvelopeData|null);

        /**
         * Creates a new Envelope instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Envelope instance
         */
        public static create(properties?: sysinfo.IEnvelope): sysinfo.Envelope;

        /**
         * Encodes the specified Envelope message. Does not implicitly {@link sysinfo.Envelope.verify|verify} messages.
         * @param message Envelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: sysinfo.IEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Envelope message, length delimited. Does not implicitly {@link sysinfo.Envelope.verify|verify} messages.
         * @param message Envelope message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: sysinfo.IEnvelope, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an Envelope message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Envelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): sysinfo.Envelope;

        /**
         * Decodes an Envelope message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Envelope
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): sysinfo.Envelope;

        /**
         * Verifies an Envelope message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an Envelope message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Envelope
         */
        public static fromObject(object: { [k: string]: any }): sysinfo.Envelope;

        /**
         * Creates a plain object from an Envelope message. Also converts values to other types if specified.
         * @param message Envelope
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: sysinfo.Envelope, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Envelope to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Envelope
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an InferenceStatePtr. */
    interface IInferenceStatePtr {

        /** InferenceStatePtr rxPtrs */
        rxPtrs?: (Uint8Array[]|null);
    }

    /** Represents an InferenceStatePtr. */
    class InferenceStatePtr implements IInferenceStatePtr {

        /**
         * Constructs a new InferenceStatePtr.
         * @param [properties] Properties to set
         */
        constructor(properties?: sysinfo.IInferenceStatePtr);

        /** InferenceStatePtr rxPtrs. */
        public rxPtrs: Uint8Array[];

        /**
         * Creates a new InferenceStatePtr instance using the specified properties.
         * @param [properties] Properties to set
         * @returns InferenceStatePtr instance
         */
        public static create(properties?: sysinfo.IInferenceStatePtr): sysinfo.InferenceStatePtr;

        /**
         * Encodes the specified InferenceStatePtr message. Does not implicitly {@link sysinfo.InferenceStatePtr.verify|verify} messages.
         * @param message InferenceStatePtr message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: sysinfo.IInferenceStatePtr, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified InferenceStatePtr message, length delimited. Does not implicitly {@link sysinfo.InferenceStatePtr.verify|verify} messages.
         * @param message InferenceStatePtr message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: sysinfo.IInferenceStatePtr, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an InferenceStatePtr message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns InferenceStatePtr
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): sysinfo.InferenceStatePtr;

        /**
         * Decodes an InferenceStatePtr message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns InferenceStatePtr
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): sysinfo.InferenceStatePtr;

        /**
         * Verifies an InferenceStatePtr message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an InferenceStatePtr message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns InferenceStatePtr
         */
        public static fromObject(object: { [k: string]: any }): sysinfo.InferenceStatePtr;

        /**
         * Creates a plain object from an InferenceStatePtr message. Also converts values to other types if specified.
         * @param message InferenceStatePtr
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: sysinfo.InferenceStatePtr, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this InferenceStatePtr to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for InferenceStatePtr
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an EnvelopeData. */
    interface IEnvelopeData {

        /** EnvelopeData os */
        os?: (sysinfo.IOsInfo|null);

        /** EnvelopeData time */
        time?: (sysinfo.ITimeInfo|null);

        /** EnvelopeData memory */
        memory?: (sysinfo.IMemory|null);

        /** EnvelopeData motherboard */
        motherboard?: (sysinfo.IMotherboard|null);

        /** EnvelopeData hostname */
        hostname?: (string|null);

        /** EnvelopeData cpuArch */
        cpuArch?: (string|null);

        /** EnvelopeData physicalCoreCount */
        physicalCoreCount?: (Long|null);

        /** EnvelopeData name */
        name?: (string|null);

        /** EnvelopeData uniqueId */
        uniqueId?: (string|null);

        /** EnvelopeData users */
        users?: (sysinfo.IUser[]|null);

        /** EnvelopeData cpu */
        cpu?: (sysinfo.ICPU[]|null);

        /** EnvelopeData disks */
        disks?: (sysinfo.IDisk[]|null);

        /** EnvelopeData networks */
        networks?: (sysinfo.INetwork[]|null);

        /** EnvelopeData temperatures */
        temperatures?: (sysinfo.ITemperatureSensor[]|null);
    }

    /** Represents an EnvelopeData. */
    class EnvelopeData implements IEnvelopeData {

        /**
         * Constructs a new EnvelopeData.
         * @param [properties] Properties to set
         */
        constructor(properties?: sysinfo.IEnvelopeData);

        /** EnvelopeData os. */
        public os?: (sysinfo.IOsInfo|null);

        /** EnvelopeData time. */
        public time?: (sysinfo.ITimeInfo|null);

        /** EnvelopeData memory. */
        public memory?: (sysinfo.IMemory|null);

        /** EnvelopeData motherboard. */
        public motherboard?: (sysinfo.IMotherboard|null);

        /** EnvelopeData hostname. */
        public hostname: string;

        /** EnvelopeData cpuArch. */
        public cpuArch: string;

        /** EnvelopeData physicalCoreCount. */
        public physicalCoreCount: Long;

        /** EnvelopeData name. */
        public name: string;

        /** EnvelopeData uniqueId. */
        public uniqueId: string;

        /** EnvelopeData users. */
        public users: sysinfo.IUser[];

        /** EnvelopeData cpu. */
        public cpu: sysinfo.ICPU[];

        /** EnvelopeData disks. */
        public disks: sysinfo.IDisk[];

        /** EnvelopeData networks. */
        public networks: sysinfo.INetwork[];

        /** EnvelopeData temperatures. */
        public temperatures: sysinfo.ITemperatureSensor[];

        /**
         * Creates a new EnvelopeData instance using the specified properties.
         * @param [properties] Properties to set
         * @returns EnvelopeData instance
         */
        public static create(properties?: sysinfo.IEnvelopeData): sysinfo.EnvelopeData;

        /**
         * Encodes the specified EnvelopeData message. Does not implicitly {@link sysinfo.EnvelopeData.verify|verify} messages.
         * @param message EnvelopeData message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: sysinfo.IEnvelopeData, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified EnvelopeData message, length delimited. Does not implicitly {@link sysinfo.EnvelopeData.verify|verify} messages.
         * @param message EnvelopeData message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: sysinfo.IEnvelopeData, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an EnvelopeData message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns EnvelopeData
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): sysinfo.EnvelopeData;

        /**
         * Decodes an EnvelopeData message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns EnvelopeData
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): sysinfo.EnvelopeData;

        /**
         * Verifies an EnvelopeData message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an EnvelopeData message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns EnvelopeData
         */
        public static fromObject(object: { [k: string]: any }): sysinfo.EnvelopeData;

        /**
         * Creates a plain object from an EnvelopeData message. Also converts values to other types if specified.
         * @param message EnvelopeData
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: sysinfo.EnvelopeData, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this EnvelopeData to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for EnvelopeData
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an OsInfo. */
    interface IOsInfo {

        /** OsInfo name */
        name?: (string|null);

        /** OsInfo release */
        release?: (string|null);

        /** OsInfo kernelVersion */
        kernelVersion?: (string|null);
    }

    /** Represents an OsInfo. */
    class OsInfo implements IOsInfo {

        /**
         * Constructs a new OsInfo.
         * @param [properties] Properties to set
         */
        constructor(properties?: sysinfo.IOsInfo);

        /** OsInfo name. */
        public name: string;

        /** OsInfo release. */
        public release: string;

        /** OsInfo kernelVersion. */
        public kernelVersion: string;

        /**
         * Creates a new OsInfo instance using the specified properties.
         * @param [properties] Properties to set
         * @returns OsInfo instance
         */
        public static create(properties?: sysinfo.IOsInfo): sysinfo.OsInfo;

        /**
         * Encodes the specified OsInfo message. Does not implicitly {@link sysinfo.OsInfo.verify|verify} messages.
         * @param message OsInfo message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: sysinfo.IOsInfo, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified OsInfo message, length delimited. Does not implicitly {@link sysinfo.OsInfo.verify|verify} messages.
         * @param message OsInfo message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: sysinfo.IOsInfo, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an OsInfo message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns OsInfo
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): sysinfo.OsInfo;

        /**
         * Decodes an OsInfo message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns OsInfo
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): sysinfo.OsInfo;

        /**
         * Verifies an OsInfo message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an OsInfo message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns OsInfo
         */
        public static fromObject(object: { [k: string]: any }): sysinfo.OsInfo;

        /**
         * Creates a plain object from an OsInfo message. Also converts values to other types if specified.
         * @param message OsInfo
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: sysinfo.OsInfo, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this OsInfo to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for OsInfo
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a TimeInfo. */
    interface ITimeInfo {

        /** TimeInfo utcOffsetSeconds */
        utcOffsetSeconds?: (Long|null);
    }

    /** Represents a TimeInfo. */
    class TimeInfo implements ITimeInfo {

        /**
         * Constructs a new TimeInfo.
         * @param [properties] Properties to set
         */
        constructor(properties?: sysinfo.ITimeInfo);

        /** TimeInfo utcOffsetSeconds. */
        public utcOffsetSeconds: Long;

        /**
         * Creates a new TimeInfo instance using the specified properties.
         * @param [properties] Properties to set
         * @returns TimeInfo instance
         */
        public static create(properties?: sysinfo.ITimeInfo): sysinfo.TimeInfo;

        /**
         * Encodes the specified TimeInfo message. Does not implicitly {@link sysinfo.TimeInfo.verify|verify} messages.
         * @param message TimeInfo message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: sysinfo.ITimeInfo, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified TimeInfo message, length delimited. Does not implicitly {@link sysinfo.TimeInfo.verify|verify} messages.
         * @param message TimeInfo message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: sysinfo.ITimeInfo, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a TimeInfo message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns TimeInfo
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): sysinfo.TimeInfo;

        /**
         * Decodes a TimeInfo message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns TimeInfo
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): sysinfo.TimeInfo;

        /**
         * Verifies a TimeInfo message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a TimeInfo message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns TimeInfo
         */
        public static fromObject(object: { [k: string]: any }): sysinfo.TimeInfo;

        /**
         * Creates a plain object from a TimeInfo message. Also converts values to other types if specified.
         * @param message TimeInfo
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: sysinfo.TimeInfo, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this TimeInfo to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for TimeInfo
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a Memory. */
    interface IMemory {

        /** Memory totalBytes */
        totalBytes?: (Long|null);

        /** Memory usedBytes */
        usedBytes?: (Long|null);

        /** Memory totalSwapBytes */
        totalSwapBytes?: (Long|null);

        /** Memory usedSwapBytes */
        usedSwapBytes?: (Long|null);
    }

    /** Represents a Memory. */
    class Memory implements IMemory {

        /**
         * Constructs a new Memory.
         * @param [properties] Properties to set
         */
        constructor(properties?: sysinfo.IMemory);

        /** Memory totalBytes. */
        public totalBytes: Long;

        /** Memory usedBytes. */
        public usedBytes: Long;

        /** Memory totalSwapBytes. */
        public totalSwapBytes: Long;

        /** Memory usedSwapBytes. */
        public usedSwapBytes: Long;

        /**
         * Creates a new Memory instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Memory instance
         */
        public static create(properties?: sysinfo.IMemory): sysinfo.Memory;

        /**
         * Encodes the specified Memory message. Does not implicitly {@link sysinfo.Memory.verify|verify} messages.
         * @param message Memory message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: sysinfo.IMemory, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Memory message, length delimited. Does not implicitly {@link sysinfo.Memory.verify|verify} messages.
         * @param message Memory message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: sysinfo.IMemory, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Memory message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Memory
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): sysinfo.Memory;

        /**
         * Decodes a Memory message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Memory
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): sysinfo.Memory;

        /**
         * Verifies a Memory message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Memory message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Memory
         */
        public static fromObject(object: { [k: string]: any }): sysinfo.Memory;

        /**
         * Creates a plain object from a Memory message. Also converts values to other types if specified.
         * @param message Memory
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: sysinfo.Memory, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Memory to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Memory
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a CPU. */
    interface ICPU {

        /** CPU name */
        name?: (string|null);

        /** CPU vendorId */
        vendorId?: (string|null);

        /** CPU brand */
        brand?: (string|null);

        /** CPU frequency */
        frequency?: (Long|null);

        /** CPU usage */
        usage?: (number|null);
    }

    /** Represents a CPU. */
    class CPU implements ICPU {

        /**
         * Constructs a new CPU.
         * @param [properties] Properties to set
         */
        constructor(properties?: sysinfo.ICPU);

        /** CPU name. */
        public name: string;

        /** CPU vendorId. */
        public vendorId: string;

        /** CPU brand. */
        public brand: string;

        /** CPU frequency. */
        public frequency: Long;

        /** CPU usage. */
        public usage: number;

        /**
         * Creates a new CPU instance using the specified properties.
         * @param [properties] Properties to set
         * @returns CPU instance
         */
        public static create(properties?: sysinfo.ICPU): sysinfo.CPU;

        /**
         * Encodes the specified CPU message. Does not implicitly {@link sysinfo.CPU.verify|verify} messages.
         * @param message CPU message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: sysinfo.ICPU, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified CPU message, length delimited. Does not implicitly {@link sysinfo.CPU.verify|verify} messages.
         * @param message CPU message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: sysinfo.ICPU, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a CPU message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns CPU
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): sysinfo.CPU;

        /**
         * Decodes a CPU message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns CPU
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): sysinfo.CPU;

        /**
         * Verifies a CPU message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a CPU message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns CPU
         */
        public static fromObject(object: { [k: string]: any }): sysinfo.CPU;

        /**
         * Creates a plain object from a CPU message. Also converts values to other types if specified.
         * @param message CPU
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: sysinfo.CPU, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this CPU to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for CPU
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a Disk. */
    interface IDisk {

        /** Disk kind */
        kind?: (string|null);

        /** Disk fs */
        fs?: (string|null);

        /** Disk name */
        name?: (string|null);

        /** Disk mountPoint */
        mountPoint?: (string|null);

        /** Disk removable */
        removable?: (boolean|null);

        /** Disk readOnly */
        readOnly?: (boolean|null);

        /** Disk totalSpaceBytes */
        totalSpaceBytes?: (Long|null);

        /** Disk availableSpaceBytes */
        availableSpaceBytes?: (Long|null);

        /** Disk totalReadBytes */
        totalReadBytes?: (Long|null);

        /** Disk totalWrittenBytes */
        totalWrittenBytes?: (Long|null);
    }

    /** Represents a Disk. */
    class Disk implements IDisk {

        /**
         * Constructs a new Disk.
         * @param [properties] Properties to set
         */
        constructor(properties?: sysinfo.IDisk);

        /** Disk kind. */
        public kind: string;

        /** Disk fs. */
        public fs: string;

        /** Disk name. */
        public name: string;

        /** Disk mountPoint. */
        public mountPoint: string;

        /** Disk removable. */
        public removable: boolean;

        /** Disk readOnly. */
        public readOnly: boolean;

        /** Disk totalSpaceBytes. */
        public totalSpaceBytes: Long;

        /** Disk availableSpaceBytes. */
        public availableSpaceBytes: Long;

        /** Disk totalReadBytes. */
        public totalReadBytes: Long;

        /** Disk totalWrittenBytes. */
        public totalWrittenBytes: Long;

        /**
         * Creates a new Disk instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Disk instance
         */
        public static create(properties?: sysinfo.IDisk): sysinfo.Disk;

        /**
         * Encodes the specified Disk message. Does not implicitly {@link sysinfo.Disk.verify|verify} messages.
         * @param message Disk message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: sysinfo.IDisk, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Disk message, length delimited. Does not implicitly {@link sysinfo.Disk.verify|verify} messages.
         * @param message Disk message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: sysinfo.IDisk, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Disk message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Disk
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): sysinfo.Disk;

        /**
         * Decodes a Disk message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Disk
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): sysinfo.Disk;

        /**
         * Verifies a Disk message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Disk message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Disk
         */
        public static fromObject(object: { [k: string]: any }): sysinfo.Disk;

        /**
         * Creates a plain object from a Disk message. Also converts values to other types if specified.
         * @param message Disk
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: sysinfo.Disk, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Disk to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Disk
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a Motherboard. */
    interface IMotherboard {

        /** Motherboard name */
        name?: (string|null);

        /** Motherboard vendorName */
        vendorName?: (string|null);

        /** Motherboard version */
        version?: (string|null);

        /** Motherboard serialNumber */
        serialNumber?: (string|null);

        /** Motherboard assetTag */
        assetTag?: (string|null);
    }

    /** Represents a Motherboard. */
    class Motherboard implements IMotherboard {

        /**
         * Constructs a new Motherboard.
         * @param [properties] Properties to set
         */
        constructor(properties?: sysinfo.IMotherboard);

        /** Motherboard name. */
        public name: string;

        /** Motherboard vendorName. */
        public vendorName: string;

        /** Motherboard version. */
        public version: string;

        /** Motherboard serialNumber. */
        public serialNumber: string;

        /** Motherboard assetTag. */
        public assetTag: string;

        /**
         * Creates a new Motherboard instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Motherboard instance
         */
        public static create(properties?: sysinfo.IMotherboard): sysinfo.Motherboard;

        /**
         * Encodes the specified Motherboard message. Does not implicitly {@link sysinfo.Motherboard.verify|verify} messages.
         * @param message Motherboard message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: sysinfo.IMotherboard, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Motherboard message, length delimited. Does not implicitly {@link sysinfo.Motherboard.verify|verify} messages.
         * @param message Motherboard message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: sysinfo.IMotherboard, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Motherboard message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Motherboard
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): sysinfo.Motherboard;

        /**
         * Decodes a Motherboard message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Motherboard
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): sysinfo.Motherboard;

        /**
         * Verifies a Motherboard message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Motherboard message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Motherboard
         */
        public static fromObject(object: { [k: string]: any }): sysinfo.Motherboard;

        /**
         * Creates a plain object from a Motherboard message. Also converts values to other types if specified.
         * @param message Motherboard
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: sysinfo.Motherboard, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Motherboard to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Motherboard
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a User. */
    interface IUser {

        /** User name */
        name?: (string|null);

        /** User groups */
        groups?: (string[]|null);
    }

    /** Represents a User. */
    class User implements IUser {

        /**
         * Constructs a new User.
         * @param [properties] Properties to set
         */
        constructor(properties?: sysinfo.IUser);

        /** User name. */
        public name: string;

        /** User groups. */
        public groups: string[];

        /**
         * Creates a new User instance using the specified properties.
         * @param [properties] Properties to set
         * @returns User instance
         */
        public static create(properties?: sysinfo.IUser): sysinfo.User;

        /**
         * Encodes the specified User message. Does not implicitly {@link sysinfo.User.verify|verify} messages.
         * @param message User message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: sysinfo.IUser, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified User message, length delimited. Does not implicitly {@link sysinfo.User.verify|verify} messages.
         * @param message User message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: sysinfo.IUser, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a User message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns User
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): sysinfo.User;

        /**
         * Decodes a User message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns User
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): sysinfo.User;

        /**
         * Verifies a User message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a User message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns User
         */
        public static fromObject(object: { [k: string]: any }): sysinfo.User;

        /**
         * Creates a plain object from a User message. Also converts values to other types if specified.
         * @param message User
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: sysinfo.User, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this User to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for User
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a NetworkIp. */
    interface INetworkIp {

        /** NetworkIp addr */
        addr?: (string|null);
    }

    /** Represents a NetworkIp. */
    class NetworkIp implements INetworkIp {

        /**
         * Constructs a new NetworkIp.
         * @param [properties] Properties to set
         */
        constructor(properties?: sysinfo.INetworkIp);

        /** NetworkIp addr. */
        public addr: string;

        /**
         * Creates a new NetworkIp instance using the specified properties.
         * @param [properties] Properties to set
         * @returns NetworkIp instance
         */
        public static create(properties?: sysinfo.INetworkIp): sysinfo.NetworkIp;

        /**
         * Encodes the specified NetworkIp message. Does not implicitly {@link sysinfo.NetworkIp.verify|verify} messages.
         * @param message NetworkIp message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: sysinfo.INetworkIp, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified NetworkIp message, length delimited. Does not implicitly {@link sysinfo.NetworkIp.verify|verify} messages.
         * @param message NetworkIp message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: sysinfo.INetworkIp, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a NetworkIp message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns NetworkIp
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): sysinfo.NetworkIp;

        /**
         * Decodes a NetworkIp message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns NetworkIp
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): sysinfo.NetworkIp;

        /**
         * Verifies a NetworkIp message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a NetworkIp message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns NetworkIp
         */
        public static fromObject(object: { [k: string]: any }): sysinfo.NetworkIp;

        /**
         * Creates a plain object from a NetworkIp message. Also converts values to other types if specified.
         * @param message NetworkIp
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: sysinfo.NetworkIp, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this NetworkIp to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for NetworkIp
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a Network. */
    interface INetwork {

        /** Network iface */
        iface?: (string|null);

        /** Network macAddress */
        macAddress?: (string|null);

        /** Network ips */
        ips?: (sysinfo.INetworkIp[]|null);

        /** Network bytesReceived */
        bytesReceived?: (Long|null);

        /** Network bytesTransmitted */
        bytesTransmitted?: (Long|null);

        /** Network packetsReceived */
        packetsReceived?: (Long|null);

        /** Network packetsTransmitted */
        packetsTransmitted?: (Long|null);

        /** Network errorsReceived */
        errorsReceived?: (Long|null);

        /** Network errorsTransmitted */
        errorsTransmitted?: (Long|null);
    }

    /** Represents a Network. */
    class Network implements INetwork {

        /**
         * Constructs a new Network.
         * @param [properties] Properties to set
         */
        constructor(properties?: sysinfo.INetwork);

        /** Network iface. */
        public iface: string;

        /** Network macAddress. */
        public macAddress: string;

        /** Network ips. */
        public ips: sysinfo.INetworkIp[];

        /** Network bytesReceived. */
        public bytesReceived: Long;

        /** Network bytesTransmitted. */
        public bytesTransmitted: Long;

        /** Network packetsReceived. */
        public packetsReceived: Long;

        /** Network packetsTransmitted. */
        public packetsTransmitted: Long;

        /** Network errorsReceived. */
        public errorsReceived: Long;

        /** Network errorsTransmitted. */
        public errorsTransmitted: Long;

        /**
         * Creates a new Network instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Network instance
         */
        public static create(properties?: sysinfo.INetwork): sysinfo.Network;

        /**
         * Encodes the specified Network message. Does not implicitly {@link sysinfo.Network.verify|verify} messages.
         * @param message Network message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: sysinfo.INetwork, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Network message, length delimited. Does not implicitly {@link sysinfo.Network.verify|verify} messages.
         * @param message Network message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: sysinfo.INetwork, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Network message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Network
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): sysinfo.Network;

        /**
         * Decodes a Network message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Network
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): sysinfo.Network;

        /**
         * Verifies a Network message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Network message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Network
         */
        public static fromObject(object: { [k: string]: any }): sysinfo.Network;

        /**
         * Creates a plain object from a Network message. Also converts values to other types if specified.
         * @param message Network
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: sysinfo.Network, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Network to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Network
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a TemperatureSensor. */
    interface ITemperatureSensor {

        /** TemperatureSensor id */
        id?: (string|null);

        /** TemperatureSensor name */
        name?: (string|null);

        /** TemperatureSensor value */
        value?: (number|null);

        /** TemperatureSensor max */
        max?: (number|null);

        /** TemperatureSensor critical */
        critical?: (number|null);
    }

    /** Represents a TemperatureSensor. */
    class TemperatureSensor implements ITemperatureSensor {

        /**
         * Constructs a new TemperatureSensor.
         * @param [properties] Properties to set
         */
        constructor(properties?: sysinfo.ITemperatureSensor);

        /** TemperatureSensor id. */
        public id: string;

        /** TemperatureSensor name. */
        public name: string;

        /** TemperatureSensor value. */
        public value: number;

        /** TemperatureSensor max. */
        public max: number;

        /** TemperatureSensor critical. */
        public critical: number;

        /**
         * Creates a new TemperatureSensor instance using the specified properties.
         * @param [properties] Properties to set
         * @returns TemperatureSensor instance
         */
        public static create(properties?: sysinfo.ITemperatureSensor): sysinfo.TemperatureSensor;

        /**
         * Encodes the specified TemperatureSensor message. Does not implicitly {@link sysinfo.TemperatureSensor.verify|verify} messages.
         * @param message TemperatureSensor message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: sysinfo.ITemperatureSensor, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified TemperatureSensor message, length delimited. Does not implicitly {@link sysinfo.TemperatureSensor.verify|verify} messages.
         * @param message TemperatureSensor message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: sysinfo.ITemperatureSensor, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a TemperatureSensor message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns TemperatureSensor
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): sysinfo.TemperatureSensor;

        /**
         * Decodes a TemperatureSensor message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns TemperatureSensor
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): sysinfo.TemperatureSensor;

        /**
         * Verifies a TemperatureSensor message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a TemperatureSensor message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns TemperatureSensor
         */
        public static fromObject(object: { [k: string]: any }): sysinfo.TemperatureSensor;

        /**
         * Creates a plain object from a TemperatureSensor message. Also converts values to other types if specified.
         * @param message TemperatureSensor
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: sysinfo.TemperatureSensor, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this TemperatureSensor to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for TemperatureSensor
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }
}

/** Namespace normvla. */
export namespace normvla {

    /** Properties of a Frame. */
    interface IFrame {

        /** Frame globalFrameId */
        globalFrameId?: (Uint8Array|null);

        /** Frame monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** Frame joints */
        joints?: (normvla.IJoint[]|null);

        /** Frame images */
        images?: (normvla.IImage[]|null);
    }

    /** Represents a Frame. */
    class Frame implements IFrame {

        /**
         * Constructs a new Frame.
         * @param [properties] Properties to set
         */
        constructor(properties?: normvla.IFrame);

        /** Frame globalFrameId. */
        public globalFrameId: Uint8Array;

        /** Frame monotonicStampNs. */
        public monotonicStampNs: Long;

        /** Frame joints. */
        public joints: normvla.IJoint[];

        /** Frame images. */
        public images: normvla.IImage[];

        /**
         * Creates a new Frame instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Frame instance
         */
        public static create(properties?: normvla.IFrame): normvla.Frame;

        /**
         * Encodes the specified Frame message. Does not implicitly {@link normvla.Frame.verify|verify} messages.
         * @param message Frame message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: normvla.IFrame, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Frame message, length delimited. Does not implicitly {@link normvla.Frame.verify|verify} messages.
         * @param message Frame message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: normvla.IFrame, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Frame message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Frame
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): normvla.Frame;

        /**
         * Decodes a Frame message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Frame
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): normvla.Frame;

        /**
         * Verifies a Frame message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Frame message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Frame
         */
        public static fromObject(object: { [k: string]: any }): normvla.Frame;

        /**
         * Creates a plain object from a Frame message. Also converts values to other types if specified.
         * @param message Frame
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: normvla.Frame, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Frame to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Frame
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a Joint. */
    interface IJoint {

        /** Joint rangeMin */
        rangeMin?: (number|null);

        /** Joint rangeMax */
        rangeMax?: (number|null);

        /** Joint position */
        position?: (number|null);

        /** Joint positionNorm */
        positionNorm?: (number|null);

        /** Joint goal */
        goal?: (number|null);

        /** Joint goalNorm */
        goalNorm?: (number|null);

        /** Joint currentMa */
        currentMa?: (number|null);

        /** Joint velocity */
        velocity?: (number|null);

        /** Joint monotonicStampNs */
        monotonicStampNs?: (Long|null);
    }

    /** Represents a Joint. */
    class Joint implements IJoint {

        /**
         * Constructs a new Joint.
         * @param [properties] Properties to set
         */
        constructor(properties?: normvla.IJoint);

        /** Joint rangeMin. */
        public rangeMin: number;

        /** Joint rangeMax. */
        public rangeMax: number;

        /** Joint position. */
        public position: number;

        /** Joint positionNorm. */
        public positionNorm: number;

        /** Joint goal. */
        public goal: number;

        /** Joint goalNorm. */
        public goalNorm: number;

        /** Joint currentMa. */
        public currentMa: number;

        /** Joint velocity. */
        public velocity: number;

        /** Joint monotonicStampNs. */
        public monotonicStampNs: Long;

        /**
         * Creates a new Joint instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Joint instance
         */
        public static create(properties?: normvla.IJoint): normvla.Joint;

        /**
         * Encodes the specified Joint message. Does not implicitly {@link normvla.Joint.verify|verify} messages.
         * @param message Joint message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: normvla.IJoint, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Joint message, length delimited. Does not implicitly {@link normvla.Joint.verify|verify} messages.
         * @param message Joint message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: normvla.IJoint, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Joint message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Joint
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): normvla.Joint;

        /**
         * Decodes a Joint message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Joint
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): normvla.Joint;

        /**
         * Verifies a Joint message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Joint message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Joint
         */
        public static fromObject(object: { [k: string]: any }): normvla.Joint;

        /**
         * Creates a plain object from a Joint message. Also converts values to other types if specified.
         * @param message Joint
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: normvla.Joint, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Joint to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Joint
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an Image. */
    interface IImage {

        /** Image jpeg */
        jpeg?: (Uint8Array|null);

        /** Image monotonicStampNs */
        monotonicStampNs?: (Long|null);
    }

    /** Represents an Image. */
    class Image implements IImage {

        /**
         * Constructs a new Image.
         * @param [properties] Properties to set
         */
        constructor(properties?: normvla.IImage);

        /** Image jpeg. */
        public jpeg: Uint8Array;

        /** Image monotonicStampNs. */
        public monotonicStampNs: Long;

        /**
         * Creates a new Image instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Image instance
         */
        public static create(properties?: normvla.IImage): normvla.Image;

        /**
         * Encodes the specified Image message. Does not implicitly {@link normvla.Image.verify|verify} messages.
         * @param message Image message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: normvla.IImage, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Image message, length delimited. Does not implicitly {@link normvla.Image.verify|verify} messages.
         * @param message Image message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: normvla.IImage, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an Image message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Image
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): normvla.Image;

        /**
         * Decodes an Image message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Image
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): normvla.Image;

        /**
         * Verifies an Image message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an Image message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Image
         */
        public static fromObject(object: { [k: string]: any }): normvla.Image;

        /**
         * Creates a plain object from an Image message. Also converts values to other types if specified.
         * @param message Image
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: normvla.Image, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Image to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Image
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }
}

/** Namespace normfs. */
export namespace normfs {

    /** Properties of a ClientRequest. */
    interface IClientRequest {

        /** ClientRequest setup */
        setup?: (normfs.ISetupRequest|null);

        /** ClientRequest ping */
        ping?: (normfs.IPingRequest|null);

        /** ClientRequest write */
        write?: (normfs.IWriteRequest|null);

        /** ClientRequest read */
        read?: (normfs.IReadRequest|null);
    }

    /** Represents a ClientRequest. */
    class ClientRequest implements IClientRequest {

        /**
         * Constructs a new ClientRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: normfs.IClientRequest);

        /** ClientRequest setup. */
        public setup?: (normfs.ISetupRequest|null);

        /** ClientRequest ping. */
        public ping?: (normfs.IPingRequest|null);

        /** ClientRequest write. */
        public write?: (normfs.IWriteRequest|null);

        /** ClientRequest read. */
        public read?: (normfs.IReadRequest|null);

        /**
         * Creates a new ClientRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ClientRequest instance
         */
        public static create(properties?: normfs.IClientRequest): normfs.ClientRequest;

        /**
         * Encodes the specified ClientRequest message. Does not implicitly {@link normfs.ClientRequest.verify|verify} messages.
         * @param message ClientRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: normfs.IClientRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ClientRequest message, length delimited. Does not implicitly {@link normfs.ClientRequest.verify|verify} messages.
         * @param message ClientRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: normfs.IClientRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ClientRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ClientRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): normfs.ClientRequest;

        /**
         * Decodes a ClientRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ClientRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): normfs.ClientRequest;

        /**
         * Verifies a ClientRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ClientRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ClientRequest
         */
        public static fromObject(object: { [k: string]: any }): normfs.ClientRequest;

        /**
         * Creates a plain object from a ClientRequest message. Also converts values to other types if specified.
         * @param message ClientRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: normfs.ClientRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ClientRequest to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ClientRequest
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ServerResponse. */
    interface IServerResponse {

        /** ServerResponse setup */
        setup?: (normfs.ISetupResponse|null);

        /** ServerResponse ping */
        ping?: (normfs.IPingResponse|null);

        /** ServerResponse write */
        write?: (normfs.IWriteResponse|null);

        /** ServerResponse read */
        read?: (normfs.IReadResponse|null);
    }

    /** Represents a ServerResponse. */
    class ServerResponse implements IServerResponse {

        /**
         * Constructs a new ServerResponse.
         * @param [properties] Properties to set
         */
        constructor(properties?: normfs.IServerResponse);

        /** ServerResponse setup. */
        public setup?: (normfs.ISetupResponse|null);

        /** ServerResponse ping. */
        public ping?: (normfs.IPingResponse|null);

        /** ServerResponse write. */
        public write?: (normfs.IWriteResponse|null);

        /** ServerResponse read. */
        public read?: (normfs.IReadResponse|null);

        /**
         * Creates a new ServerResponse instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ServerResponse instance
         */
        public static create(properties?: normfs.IServerResponse): normfs.ServerResponse;

        /**
         * Encodes the specified ServerResponse message. Does not implicitly {@link normfs.ServerResponse.verify|verify} messages.
         * @param message ServerResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: normfs.IServerResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ServerResponse message, length delimited. Does not implicitly {@link normfs.ServerResponse.verify|verify} messages.
         * @param message ServerResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: normfs.IServerResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ServerResponse message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ServerResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): normfs.ServerResponse;

        /**
         * Decodes a ServerResponse message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ServerResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): normfs.ServerResponse;

        /**
         * Verifies a ServerResponse message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ServerResponse message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ServerResponse
         */
        public static fromObject(object: { [k: string]: any }): normfs.ServerResponse;

        /**
         * Creates a plain object from a ServerResponse message. Also converts values to other types if specified.
         * @param message ServerResponse
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: normfs.ServerResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ServerResponse to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ServerResponse
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an Id. */
    interface IId {

        /** Id raw */
        raw?: (Uint8Array|null);
    }

    /** Represents an Id. */
    class Id implements IId {

        /**
         * Constructs a new Id.
         * @param [properties] Properties to set
         */
        constructor(properties?: normfs.IId);

        /** Id raw. */
        public raw: Uint8Array;

        /**
         * Creates a new Id instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Id instance
         */
        public static create(properties?: normfs.IId): normfs.Id;

        /**
         * Encodes the specified Id message. Does not implicitly {@link normfs.Id.verify|verify} messages.
         * @param message Id message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: normfs.IId, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Id message, length delimited. Does not implicitly {@link normfs.Id.verify|verify} messages.
         * @param message Id message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: normfs.IId, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an Id message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Id
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): normfs.Id;

        /**
         * Decodes an Id message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Id
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): normfs.Id;

        /**
         * Verifies an Id message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an Id message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Id
         */
        public static fromObject(object: { [k: string]: any }): normfs.Id;

        /**
         * Creates a plain object from an Id message. Also converts values to other types if specified.
         * @param message Id
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: normfs.Id, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Id to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Id
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** OffsetType enum. */
    enum OffsetType {
        OT_ABSOLUTE = 0,
        OT_SHIFT_FROM_TAIL = 1
    }

    /** Properties of an Offset. */
    interface IOffset {

        /** Offset id */
        id?: (normfs.IId|null);

        /** Offset type */
        type?: (normfs.OffsetType|null);
    }

    /** Represents an Offset. */
    class Offset implements IOffset {

        /**
         * Constructs a new Offset.
         * @param [properties] Properties to set
         */
        constructor(properties?: normfs.IOffset);

        /** Offset id. */
        public id?: (normfs.IId|null);

        /** Offset type. */
        public type: normfs.OffsetType;

        /**
         * Creates a new Offset instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Offset instance
         */
        public static create(properties?: normfs.IOffset): normfs.Offset;

        /**
         * Encodes the specified Offset message. Does not implicitly {@link normfs.Offset.verify|verify} messages.
         * @param message Offset message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: normfs.IOffset, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Offset message, length delimited. Does not implicitly {@link normfs.Offset.verify|verify} messages.
         * @param message Offset message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: normfs.IOffset, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an Offset message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Offset
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): normfs.Offset;

        /**
         * Decodes an Offset message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Offset
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): normfs.Offset;

        /**
         * Verifies an Offset message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an Offset message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Offset
         */
        public static fromObject(object: { [k: string]: any }): normfs.Offset;

        /**
         * Creates a plain object from an Offset message. Also converts values to other types if specified.
         * @param message Offset
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: normfs.Offset, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Offset to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Offset
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a SetupRequest. */
    interface ISetupRequest {

        /** SetupRequest version */
        version?: (Long|null);
    }

    /** Represents a SetupRequest. */
    class SetupRequest implements ISetupRequest {

        /**
         * Constructs a new SetupRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: normfs.ISetupRequest);

        /** SetupRequest version. */
        public version: Long;

        /**
         * Creates a new SetupRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns SetupRequest instance
         */
        public static create(properties?: normfs.ISetupRequest): normfs.SetupRequest;

        /**
         * Encodes the specified SetupRequest message. Does not implicitly {@link normfs.SetupRequest.verify|verify} messages.
         * @param message SetupRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: normfs.ISetupRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified SetupRequest message, length delimited. Does not implicitly {@link normfs.SetupRequest.verify|verify} messages.
         * @param message SetupRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: normfs.ISetupRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a SetupRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns SetupRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): normfs.SetupRequest;

        /**
         * Decodes a SetupRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns SetupRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): normfs.SetupRequest;

        /**
         * Verifies a SetupRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a SetupRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns SetupRequest
         */
        public static fromObject(object: { [k: string]: any }): normfs.SetupRequest;

        /**
         * Creates a plain object from a SetupRequest message. Also converts values to other types if specified.
         * @param message SetupRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: normfs.SetupRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this SetupRequest to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for SetupRequest
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a SetupResponse. */
    interface ISetupResponse {

        /** SetupResponse version */
        version?: (Long|null);

        /** SetupResponse instanceIdBytes */
        instanceIdBytes?: (Uint8Array|null);

        /** SetupResponse instanceId */
        instanceId?: (string|null);
    }

    /** Represents a SetupResponse. */
    class SetupResponse implements ISetupResponse {

        /**
         * Constructs a new SetupResponse.
         * @param [properties] Properties to set
         */
        constructor(properties?: normfs.ISetupResponse);

        /** SetupResponse version. */
        public version: Long;

        /** SetupResponse instanceIdBytes. */
        public instanceIdBytes: Uint8Array;

        /** SetupResponse instanceId. */
        public instanceId: string;

        /**
         * Creates a new SetupResponse instance using the specified properties.
         * @param [properties] Properties to set
         * @returns SetupResponse instance
         */
        public static create(properties?: normfs.ISetupResponse): normfs.SetupResponse;

        /**
         * Encodes the specified SetupResponse message. Does not implicitly {@link normfs.SetupResponse.verify|verify} messages.
         * @param message SetupResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: normfs.ISetupResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified SetupResponse message, length delimited. Does not implicitly {@link normfs.SetupResponse.verify|verify} messages.
         * @param message SetupResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: normfs.ISetupResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a SetupResponse message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns SetupResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): normfs.SetupResponse;

        /**
         * Decodes a SetupResponse message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns SetupResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): normfs.SetupResponse;

        /**
         * Verifies a SetupResponse message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a SetupResponse message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns SetupResponse
         */
        public static fromObject(object: { [k: string]: any }): normfs.SetupResponse;

        /**
         * Creates a plain object from a SetupResponse message. Also converts values to other types if specified.
         * @param message SetupResponse
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: normfs.SetupResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this SetupResponse to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for SetupResponse
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a PingRequest. */
    interface IPingRequest {

        /** PingRequest sequence */
        sequence?: (Long|null);

        /** PingRequest clientTimestampNs */
        clientTimestampNs?: (Long|null);
    }

    /** Represents a PingRequest. */
    class PingRequest implements IPingRequest {

        /**
         * Constructs a new PingRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: normfs.IPingRequest);

        /** PingRequest sequence. */
        public sequence: Long;

        /** PingRequest clientTimestampNs. */
        public clientTimestampNs: Long;

        /**
         * Creates a new PingRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns PingRequest instance
         */
        public static create(properties?: normfs.IPingRequest): normfs.PingRequest;

        /**
         * Encodes the specified PingRequest message. Does not implicitly {@link normfs.PingRequest.verify|verify} messages.
         * @param message PingRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: normfs.IPingRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified PingRequest message, length delimited. Does not implicitly {@link normfs.PingRequest.verify|verify} messages.
         * @param message PingRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: normfs.IPingRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a PingRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns PingRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): normfs.PingRequest;

        /**
         * Decodes a PingRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns PingRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): normfs.PingRequest;

        /**
         * Verifies a PingRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a PingRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns PingRequest
         */
        public static fromObject(object: { [k: string]: any }): normfs.PingRequest;

        /**
         * Creates a plain object from a PingRequest message. Also converts values to other types if specified.
         * @param message PingRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: normfs.PingRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this PingRequest to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for PingRequest
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a PingResponse. */
    interface IPingResponse {

        /** PingResponse localStampNs */
        localStampNs?: (Long|null);

        /** PingResponse monotonicStampNs */
        monotonicStampNs?: (Long|null);

        /** PingResponse request */
        request?: (normfs.IPingRequest|null);
    }

    /** Represents a PingResponse. */
    class PingResponse implements IPingResponse {

        /**
         * Constructs a new PingResponse.
         * @param [properties] Properties to set
         */
        constructor(properties?: normfs.IPingResponse);

        /** PingResponse localStampNs. */
        public localStampNs: Long;

        /** PingResponse monotonicStampNs. */
        public monotonicStampNs: Long;

        /** PingResponse request. */
        public request?: (normfs.IPingRequest|null);

        /**
         * Creates a new PingResponse instance using the specified properties.
         * @param [properties] Properties to set
         * @returns PingResponse instance
         */
        public static create(properties?: normfs.IPingResponse): normfs.PingResponse;

        /**
         * Encodes the specified PingResponse message. Does not implicitly {@link normfs.PingResponse.verify|verify} messages.
         * @param message PingResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: normfs.IPingResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified PingResponse message, length delimited. Does not implicitly {@link normfs.PingResponse.verify|verify} messages.
         * @param message PingResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: normfs.IPingResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a PingResponse message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns PingResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): normfs.PingResponse;

        /**
         * Decodes a PingResponse message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns PingResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): normfs.PingResponse;

        /**
         * Verifies a PingResponse message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a PingResponse message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns PingResponse
         */
        public static fromObject(object: { [k: string]: any }): normfs.PingResponse;

        /**
         * Creates a plain object from a PingResponse message. Also converts values to other types if specified.
         * @param message PingResponse
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: normfs.PingResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this PingResponse to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for PingResponse
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a WriteRequest. */
    interface IWriteRequest {

        /** WriteRequest writeId */
        writeId?: (Long|null);

        /** WriteRequest queueId */
        queueId?: (string|null);

        /** WriteRequest packets */
        packets?: (Uint8Array[]|null);
    }

    /** Represents a WriteRequest. */
    class WriteRequest implements IWriteRequest {

        /**
         * Constructs a new WriteRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: normfs.IWriteRequest);

        /** WriteRequest writeId. */
        public writeId: Long;

        /** WriteRequest queueId. */
        public queueId: string;

        /** WriteRequest packets. */
        public packets: Uint8Array[];

        /**
         * Creates a new WriteRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns WriteRequest instance
         */
        public static create(properties?: normfs.IWriteRequest): normfs.WriteRequest;

        /**
         * Encodes the specified WriteRequest message. Does not implicitly {@link normfs.WriteRequest.verify|verify} messages.
         * @param message WriteRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: normfs.IWriteRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified WriteRequest message, length delimited. Does not implicitly {@link normfs.WriteRequest.verify|verify} messages.
         * @param message WriteRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: normfs.IWriteRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a WriteRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns WriteRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): normfs.WriteRequest;

        /**
         * Decodes a WriteRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns WriteRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): normfs.WriteRequest;

        /**
         * Verifies a WriteRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a WriteRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns WriteRequest
         */
        public static fromObject(object: { [k: string]: any }): normfs.WriteRequest;

        /**
         * Creates a plain object from a WriteRequest message. Also converts values to other types if specified.
         * @param message WriteRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: normfs.WriteRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this WriteRequest to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for WriteRequest
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a WriteResponse. */
    interface IWriteResponse {

        /** WriteResponse writeId */
        writeId?: (Long|null);

        /** WriteResponse result */
        result?: (normfs.WriteResponse.Result|null);

        /** WriteResponse ids */
        ids?: (normfs.IId[]|null);
    }

    /** Represents a WriteResponse. */
    class WriteResponse implements IWriteResponse {

        /**
         * Constructs a new WriteResponse.
         * @param [properties] Properties to set
         */
        constructor(properties?: normfs.IWriteResponse);

        /** WriteResponse writeId. */
        public writeId: Long;

        /** WriteResponse result. */
        public result: normfs.WriteResponse.Result;

        /** WriteResponse ids. */
        public ids: normfs.IId[];

        /**
         * Creates a new WriteResponse instance using the specified properties.
         * @param [properties] Properties to set
         * @returns WriteResponse instance
         */
        public static create(properties?: normfs.IWriteResponse): normfs.WriteResponse;

        /**
         * Encodes the specified WriteResponse message. Does not implicitly {@link normfs.WriteResponse.verify|verify} messages.
         * @param message WriteResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: normfs.IWriteResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified WriteResponse message, length delimited. Does not implicitly {@link normfs.WriteResponse.verify|verify} messages.
         * @param message WriteResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: normfs.IWriteResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a WriteResponse message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns WriteResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): normfs.WriteResponse;

        /**
         * Decodes a WriteResponse message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns WriteResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): normfs.WriteResponse;

        /**
         * Verifies a WriteResponse message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a WriteResponse message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns WriteResponse
         */
        public static fromObject(object: { [k: string]: any }): normfs.WriteResponse;

        /**
         * Creates a plain object from a WriteResponse message. Also converts values to other types if specified.
         * @param message WriteResponse
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: normfs.WriteResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this WriteResponse to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for WriteResponse
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    namespace WriteResponse {

        /** Result enum. */
        enum Result {
            WR_DONE = 0,
            WR_SERVER_ERROR = 1
        }
    }

    /** Properties of a ReadRequest. */
    interface IReadRequest {

        /** ReadRequest readId */
        readId?: (Long|null);

        /** ReadRequest queueId */
        queueId?: (string|null);

        /** ReadRequest step */
        step?: (Long|null);

        /** ReadRequest offset */
        offset?: (normfs.IOffset|null);

        /** ReadRequest limit */
        limit?: (Long|null);
    }

    /** Represents a ReadRequest. */
    class ReadRequest implements IReadRequest {

        /**
         * Constructs a new ReadRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: normfs.IReadRequest);

        /** ReadRequest readId. */
        public readId: Long;

        /** ReadRequest queueId. */
        public queueId: string;

        /** ReadRequest step. */
        public step: Long;

        /** ReadRequest offset. */
        public offset?: (normfs.IOffset|null);

        /** ReadRequest limit. */
        public limit: Long;

        /**
         * Creates a new ReadRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ReadRequest instance
         */
        public static create(properties?: normfs.IReadRequest): normfs.ReadRequest;

        /**
         * Encodes the specified ReadRequest message. Does not implicitly {@link normfs.ReadRequest.verify|verify} messages.
         * @param message ReadRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: normfs.IReadRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ReadRequest message, length delimited. Does not implicitly {@link normfs.ReadRequest.verify|verify} messages.
         * @param message ReadRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: normfs.IReadRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ReadRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ReadRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): normfs.ReadRequest;

        /**
         * Decodes a ReadRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ReadRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): normfs.ReadRequest;

        /**
         * Verifies a ReadRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ReadRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ReadRequest
         */
        public static fromObject(object: { [k: string]: any }): normfs.ReadRequest;

        /**
         * Creates a plain object from a ReadRequest message. Also converts values to other types if specified.
         * @param message ReadRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: normfs.ReadRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ReadRequest to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ReadRequest
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ReadResponse. */
    interface IReadResponse {

        /** ReadResponse readId */
        readId?: (Long|null);

        /** ReadResponse result */
        result?: (normfs.ReadResponse.Result|null);

        /** ReadResponse id */
        id?: (normfs.IId|null);

        /** ReadResponse data */
        data?: (Uint8Array|null);

        /** ReadResponse dataSource */
        dataSource?: (normfs.ReadResponse.DataSource|null);
    }

    /** Represents a ReadResponse. */
    class ReadResponse implements IReadResponse {

        /**
         * Constructs a new ReadResponse.
         * @param [properties] Properties to set
         */
        constructor(properties?: normfs.IReadResponse);

        /** ReadResponse readId. */
        public readId: Long;

        /** ReadResponse result. */
        public result: normfs.ReadResponse.Result;

        /** ReadResponse id. */
        public id?: (normfs.IId|null);

        /** ReadResponse data. */
        public data: Uint8Array;

        /** ReadResponse dataSource. */
        public dataSource: normfs.ReadResponse.DataSource;

        /**
         * Creates a new ReadResponse instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ReadResponse instance
         */
        public static create(properties?: normfs.IReadResponse): normfs.ReadResponse;

        /**
         * Encodes the specified ReadResponse message. Does not implicitly {@link normfs.ReadResponse.verify|verify} messages.
         * @param message ReadResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: normfs.IReadResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ReadResponse message, length delimited. Does not implicitly {@link normfs.ReadResponse.verify|verify} messages.
         * @param message ReadResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: normfs.IReadResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ReadResponse message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ReadResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): normfs.ReadResponse;

        /**
         * Decodes a ReadResponse message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ReadResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): normfs.ReadResponse;

        /**
         * Verifies a ReadResponse message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ReadResponse message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ReadResponse
         */
        public static fromObject(object: { [k: string]: any }): normfs.ReadResponse;

        /**
         * Creates a plain object from a ReadResponse message. Also converts values to other types if specified.
         * @param message ReadResponse
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: normfs.ReadResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ReadResponse to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ReadResponse
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    namespace ReadResponse {

        /** Result enum. */
        enum Result {
            RR_START = 0,
            RR_ENTRY = 1,
            RR_END = 2,
            RR_QUEUE_NOT_FOUND = 3,
            RR_NOT_FOUND = 4,
            RR_SERVER_ERROR = 5
        }

        /** DataSource enum. */
        enum DataSource {
            DS_NONE = 0,
            DS_CLOUD = 1,
            DS_DISK_STORE = 2,
            DS_DISK_WAL = 3,
            DS_MEMORY = 4
        }
    }
}
