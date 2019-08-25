import * as express from "express";

import { ServiceServer } from "../dsrpc";

const app = express();

const handler = {
    "getOrCreateUser": async (_ctx: object, _req: {x: number, y: number}) => {
        return Promise.reject(new Error("fo"));
        // return Promise.resolve({foo: "bar", req: req});
    }
};

const server = new ServiceServer(handler);

app.use("/api", server.buildRouter());

app.listen(3000, () => {
    console.log("Started ...");
});
