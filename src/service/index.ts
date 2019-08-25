import * as express from "express";

import {rpcHandler, ServiceServer} from "../dsrpc";

const app = express();

class Handler {

    @rpcHandler
    public async getOrCreateUser(_ctx: object, req: {x: number, y: number}): Promise<{foo: string, req: any}> {
        // return Promise.reject(new Error("fo"));
        return Promise.resolve({foo: "bar", req: req});
    }

    public toString(): string {
        return "FOO";
    }
}

const handler = new Handler();
const server = new ServiceServer(handler);

app.use("/api", server.buildRouter());

app.listen(3000, () => {
    console.log("Started ...");
});
