import { Api, InputFile } from "grammy";
import { loadConfig } from "../../config/env.js";
import { ToolExecutionResult } from "../types.js";

export interface SetProfilePhotoArgs {
    file_id: string;
}

export const setProfilePhotoTool = {
    definition: {
        name: "set_profile_photo",
        description: "Cambia la foto de perfil del bot de Telegram utilizando un file_id proporcionado por el usuario en una imagen.",
        inputSchema: {
            type: "object",
            properties: {
                file_id: {
                    type: "string",
                    description: "El identificador del archivo (file_id) de la imagen a usar como foto de perfil.",
                },
            },
            required: ["file_id"],
            additionalProperties: false,
        },
    },
    async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
        const file_id = args.file_id as string;
        if (!file_id) {
            return { ok: false, output: "Error: No se ha proporcionado un file_id." };
        }

        try {
            const config = loadConfig();
            const api = new Api(config.telegramBotToken);

            // Obtener el path del archivo desde Telegram
            const file = await api.getFile(file_id);
            if (!file.file_path) {
                return { ok: false, output: "Error: No se pudo obtener la ruta del archivo." };
            }

            // Descargar y preparar la foto
            const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
            const response = await fetch(fileUrl);
            if (!response.ok) {
                return { ok: false, output: `Error: Fallo al descargar la imagen desde Telegram (Status: ${response.status}).` };
            }

            const buffer = Buffer.from(await response.arrayBuffer());
            const inputFile = new InputFile(buffer);

            // Cambiar la foto de perfil usando el InputFile
            await api.setMyProfilePhoto({
                type: "static",
                photo: inputFile,
            });

            return {
                ok: true,
                output: "La foto de perfil se ha actualizado correctamente.",
            };
        } catch (error: any) {
            return {
                ok: false,
                output: `Error al cambiar la foto de perfil: ${error.message || String(error)}`,
            };
        }
    },
};
