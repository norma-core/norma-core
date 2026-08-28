import { st3215, drivers, commands, motors_mirroring, inference_tags, vesc_trampa, pwm_output, yahboom_dogzilla_lite, usbvideo, dfrobot_rs485 } from "./proto.js";
import webSocketManager from "./websocket.js";

function commandIdToBytes(id: number): Uint8Array {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint32(0, id, false); // false for Big Endian
    return new Uint8Array(buffer);
}

// Seeded per page load so ids never collide with a previous session's acks
// still lingering on the wire (a stale COMMAND_FAILED for id 1 could
// otherwise match and abort a brand-new run). Stays well inside u32 range
// even after many increments.
let nextCommandId = (Date.now() & 0x3fffffff) >>> 0;

export class CommandManager {
    private readonly COMMANDS_QUEUE = "commands";

    private async sendCommand(commandType: drivers.StationCommandType, body: Uint8Array): Promise<number> {
        const commandId = nextCommandId++;
        const commandIdBytes = commandIdToBytes(commandId);

        const commandsPack: commands.IStationCommandsPack = {
            commands: [
                {
                    commandId: commandIdBytes,
                    type: commandType,
                    body: body,
                }
            ]
        };

        const packet = commands.StationCommandsPack.encode(commandsPack).finish();
        await webSocketManager.normFs.enqueuePack(this.COMMANDS_QUEUE, [packet]);
        return commandId;
    }

    public async sendSt3215Command(command: st3215.ICommand): Promise<void> {
        const body = st3215.Command.encode(command).finish();
        await this.sendCommand(drivers.StationCommandType.STC_ST3215_COMMAND, body);
    }

    public async sendSt3215Commands(st3215Commands: st3215.ICommand[]): Promise<void> {
        const commandId = nextCommandId++;

        const commandsPack: commands.IStationCommandsPack = {
            commands: st3215Commands.map(command => ({
                commandId: commandIdToBytes(commandId),
                type: drivers.StationCommandType.STC_ST3215_COMMAND,
                body: st3215.Command.encode(command).finish(),
            }))
        };

        const packet = commands.StationCommandsPack.encode(commandsPack).finish();
        await webSocketManager.normFs.enqueuePack(this.COMMANDS_QUEUE, [packet]);
    }

    public async sendMirroringCommand(command: motors_mirroring.ICommand): Promise<void> {
        const body = motors_mirroring.Command.encode(command).finish();
        await this.sendCommand(drivers.StationCommandType.STC_MOTOR_MIRRORING_COMMAND, body);
    }

    public async sendInferenceTagCommand(command: inference_tags.ICommand): Promise<void> {
        const body = inference_tags.Command.encode(command).finish();
        await this.sendCommand(drivers.StationCommandType.STC_INFERENCE_TAG_COMMAND, body);
    }

    public async sendVescTrampaCommand(command: vesc_trampa.ICommand): Promise<void> {
        const body = vesc_trampa.Command.encode(command).finish();
        await this.sendCommand(drivers.StationCommandType.STC_VESC_TRAMPA_COMMAND, body);
    }

    public async sendPwmOutputCommand(command: pwm_output.ICommand): Promise<void> {
        const body = pwm_output.Command.encode(command).finish();
        await this.sendCommand(drivers.StationCommandType.STC_PWM_OUTPUT_COMMAND, body);
    }

    public async sendUsbVideoCommand(command: usbvideo.ICommand): Promise<void> {
        const body = usbvideo.Command.encode(command).finish();
        await this.sendCommand(drivers.StationCommandType.STC_USB_VIDEO_COMMAND, body);
    }
    
    public async sendYahboomDogzillaLiteCommand(command: yahboom_dogzilla_lite.ICommand): Promise<void> {
        const body = yahboom_dogzilla_lite.Command.encode(command).finish();
        await this.sendCommand(drivers.StationCommandType.STC_YAHBOOM_DOGZILLA_LITE_COMMAND, body);
    }

    // Returns the command id; the driver echoes its 4-byte big-endian form
    // in RxEnvelope.command.commandId on the DFROBOT_COMMAND_* ack.
    public async sendDfrobotRs485Command(command: dfrobot_rs485.ICommand): Promise<number> {
        const body = dfrobot_rs485.Command.encode(command).finish();
        return this.sendCommand(drivers.StationCommandType.STC_DFROBOT_RS485_COMMAND, body);
    }
}

export const commandManager = new CommandManager();
