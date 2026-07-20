import { st3215, drivers, commands, motors_mirroring, inference_tags, yahboom_dogzilla_lite } from "./proto.js";
import webSocketManager from "./websocket.js";

function commandIdToBytes(id: number): Uint8Array {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint32(0, id, false); // false for Big Endian
    return new Uint8Array(buffer);
}

let nextCommandId = 1;

export class CommandManager {
    private readonly COMMANDS_QUEUE = "commands";

    private async sendCommand(commandType: drivers.StationCommandType, body: Uint8Array): Promise<void> {
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

    public async sendGravityCompCommand(command: motors_mirroring.IGravityCompCommand): Promise<void> {
        const body = motors_mirroring.GravityCompCommand.encode(command).finish();
        await this.sendCommand(drivers.StationCommandType.STC_GRAVITY_COMP_COMMAND, body);
    }

    public async sendInferenceTagCommand(command: inference_tags.ICommand): Promise<void> {
        const body = inference_tags.Command.encode(command).finish();
        await this.sendCommand(drivers.StationCommandType.STC_INFERENCE_TAG_COMMAND, body);
    }

    public async sendYahboomDogzillaLiteCommand(command: yahboom_dogzilla_lite.ICommand): Promise<void> {
        const body = yahboom_dogzilla_lite.Command.encode(command).finish();
        await this.sendCommand(drivers.StationCommandType.STC_YAHBOOM_DOGZILLA_LITE_COMMAND, body);
    }
}

export const commandManager = new CommandManager();
