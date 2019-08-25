import * as axios from "axios";
import * as express from "express";

export type RpcContext = object;
export type RpcReq = object;
export type RpcRes = object;

export class ServiceClientError extends Error {

    constructor(
        private readonly code: ServiceResponseErrors,
        private readonly error: string) {
        super();
    }

    public toString(): string {
        switch (this.code) {
            case ServiceResponseErrors.TRANSPORT_ERROR:
                return `ServiceClientError/TransportError: ${this.error}`;
            case ServiceResponseErrors.JSON_PARSING_ERROR:
                return `ServiceClientError/JsonParsingError: ${this.error}`;
            case ServiceResponseErrors.HANDLER_ERROR:
                return `ServiceClientError/HandlerError: ${this.error}`;
            default:
                return `ServiceClientError/Unknown: ${this.error}`;
        }
    }
}

export class ServiceClient {

    private static readonly DEFAULT_TIMEOUT_MS = 1000;
    private static readonly DEFAULT_MAX_RESPONSE_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

    private readonly transporter: axios.AxiosInstance;

    public constructor(
        serverBaseUrl: string) {

        this.transporter = axios.default.create({
            baseURL: serverBaseUrl,
            timeout: ServiceClient.DEFAULT_TIMEOUT_MS,
            headers: { },
            responseType: 'json',
            maxContentLength: ServiceClient.DEFAULT_MAX_RESPONSE_SIZE_BYTES,
            maxRedirects: 0
        });
    }

    public async do<Req extends RpcReq, Res extends RpcRes>(methodName: string, req: Req): Promise<Res> {
        let response = null;
        try {
            const axiosResponse = await this.transporter.post(`/method/${methodName}`, req);
            response = axiosResponse.data as ServiceResponse<Res>;
        } catch (e) {
            throw new ServiceClientError(ServiceResponseErrors.TRANSPORT_ERROR, e.toString());
        }

        if (response.code === ServiceResponseErrors.OK) {
            return response.data as Res;
        } else {
            throw new ServiceClientError(response.code, response.error as string);
        }
    }
}

type ServiceHandlerMethod<Req extends RpcReq, Res extends RpcRes> = (ctx: RpcContext, req: Req) => Promise<Res>;

export interface ServiceHandler {
    [methodName: string]: ServiceHandlerMethod<any, any>;
}

export enum ServiceResponseErrors {
    OK = 0,
    JSON_PARSING_ERROR = 1000,
    HANDLER_ERROR = 1001,
    TRANSPORT_ERROR = 2000
}

export interface ServiceResponse<Res extends RpcRes> {
    code: ServiceResponseErrors;
    error?: string;
    data?: Res;
}

export class ServiceServer {

    public constructor(
        private readonly handler: ServiceHandler) {
    }

    public buildRouter(): express.Application {
        const app = express();

        for (const methodName of Object.keys(this.handler)) {
            const methodHandler = this.handler[methodName];

            app.post(`/method/${methodName}`, (req: express.Request, res: express.Response, next: express.NextFunction) => {
                express.json()(req, res, (err) => {
                    if (err) {
                        const response: ServiceResponse<any> = {
                            code: ServiceResponseErrors.JSON_PARSING_ERROR,
                            error: err.toString()
                        };

                        res.json(response);
                        res.end();
                        return;
                    }

                    next();
                })
            }, async (req: express.Request, res: express.Response) => {
                const ctx = {};
                const requestData = req.body;

                try {
                    const responseData = await methodHandler(ctx, requestData);
                    const response: ServiceResponse<any> = {
                        code: ServiceResponseErrors.OK,
                        data: responseData
                    };

                    res.json(response);
                    res.end();
                } catch (e) {
                    const response: ServiceResponse<any> = {
                        code: ServiceResponseErrors.HANDLER_ERROR,
                        error: e.toString()
                    };

                    res.json(response);
                    res.end();
                }
            });
        }

        app.get("/info", (_req: express.Request, res: express.Response) => {
            let message = "";
            for (const methodName of Object.keys(this.handler)) {
                message += `Method: ${methodName}`;
            }

            res.send(message);
            res.status(200);
            res.end();
        });

        return app;
    }
}