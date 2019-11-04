import * as express from "express";
import * as knex from "knex";

import {ServiceServer} from "../shared/dsrpc";
import {Handler} from "./Handler";

function main() {

    const conn = knex({
        client: "pg",
        connection: {
            host: process.env.POSTGRES_HOST as string,
            port: Number.parseInt(process.env.POSTGRES_PORT as string),
            database: process.env.POSTGRES_DATABASE as string,
            user: process.env.POSTGRES_USERNAME as string,
            password: process.env.POSTGRES_PASSWORD as string
        }
    });

    const app = express();

    const handler = new Handler(conn);
    const server = new ServiceServer({
        authTokenLifeHours: Number.parseInt(process.env.AUTH_TOKEN_LIFE_HOURS as string),
        authTokenEncryptionKey: process.env.AUTH_TOKEN_ENCRYPTION_KEY as string
    }, handler);

    app.use("/api", server.buildRouter());

    app.listen(3001, () => {
        console.log("Started ...");
    });
}

main();