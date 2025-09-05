import { createLogger, format, transports } from "winston";
import path from "path";

const logFilePath = path.join(__dirname,"../../logs/server.log");

export const logger = createLogger({
    level: "info",
    format: format.combine(
        format.timestamp({format: "Date - YYYY-MM-DD and Time - HH:MM:SS" }),
        format.printf(({ timestamp, level, message}) =>{
            return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        })
    ),

    transports:[
        new transports.Console(),
        new transports.File({filename: logFilePath})
    ],
});