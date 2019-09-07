import * as express from "express";
import * as knex from "knex";

import {ServiceServer} from "../shared/dsrpc";
import {Handler} from "./Handler";

function main() {

    const conn = knex({
        client: "pg",
        connection: {
            host: process.env.POSTGRES_HOST as string,
            port: process.env.POSTGRES_PORT as string,
            database: process.env.POSTGRES_DATABASE as string,
            user: process.env.POSTGRES_USERNAME as string,
            password: process.env.POSTGRES_PASSWORD as string
        }
    });

    const app = express();

    const handler = new Handler(conn);
    const server = new ServiceServer(handler);

    app.use("/api", server.buildRouter());

    app.listen(3000, () => {
        console.log("Started ...");
    });
}

main();