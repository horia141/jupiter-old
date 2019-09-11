import * as axios from "axios";
import * as express from "express";
import * as moment from "moment";
import * as jwt from "jsonwebtoken";
import {VerifyErrors} from "jsonwebtoken";

export class RpcContext<Auth> {

    private readonly rightNow: moment.Moment;
    private auth: Auth | null;

    private constructor(rightNow: moment.Moment, auth: Auth | null) {
        this.rightNow = rightNow;
        this.auth = auth;
    }

    public static buildWithNoAuth<Auth>(): RpcContext<Auth> {
        return new RpcContext<Auth>(moment.utc(), null);
    }

    public static buildWithAuth<Auth>(auth: Auth): RpcContext<Auth> {
        return new RpcContext<Auth>(moment.utc(), auth);
    }

    public getRightNow(): moment.Moment {
        return this.rightNow;
    }

    public setAuth(auth: Auth): void {
        this.auth = auth;
    }

    public hasAuth(): boolean {
        return this.auth !== null;
    }

    public getAuth(): Auth {
        if (this.auth === null) {
            throw new Error("Accessing auth when there isn't one");
        }

        return this.auth;
    }
}

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
            case ServiceResponseErrors.JSON_PARSING_ERROR:
                return `ServiceClientError/JsonParsingError: ${this.error}`;
            case ServiceResponseErrors.REQUEST_VALIDATION_ERROR:
                return `ServiceClientError/JsonParsingError: ${this.error}`;
            case ServiceResponseErrors.REQUEST_MISSING_AUTH_TOKEN:
                return `ServiceClientError/MissingAuthToken: ${this.error}`;
            case ServiceResponseErrors.REQUEST_INVALID_AUTH_TOKEN:
                return `ServiceClientError/InvalidAuthToken: ${this.error}`;
            case ServiceResponseErrors.TRANSPORT_ERROR:
                return `ServiceClientError/TransportError: ${this.error}`;
            case ServiceResponseErrors.RESPONSE_VALIDATION_ERROR:
                return `ServiceClientError/ResponseValidationError: ${this.error}`;
            case ServiceResponseErrors.HANDLER_ERROR:
                return `ServiceClientError/HandlerError: ${this.error}`;
            default:
                return `ServiceClientError/Unknown: ${this.error}`;
        }
    }
}

export class ServiceClient {

    private static readonly DEFAULT_TIMEOUT_MS = 1000;
    private static readonly DEFAULT_MAX_RESPONSE_SIZE_BYTES = 1024 * 1024; // 1 MB

    private readonly transporter: axios.AxiosInstance;
    private authToken: string | null;

    private constructor(
        serverBaseUrl: string,
        authToken: string | null) {

        this.transporter = axios.default.create({
            baseURL: serverBaseUrl,
            timeout: ServiceClient.DEFAULT_TIMEOUT_MS,
            headers: { },
            responseType: 'json',
            maxContentLength: ServiceClient.DEFAULT_MAX_RESPONSE_SIZE_BYTES,
            maxRedirects: 0
        });
        this.authToken = authToken;
    }

    public static build(serverBaseUrl: string, authToken?: string) {
        return new ServiceClient(serverBaseUrl, authToken || null);
    }

    public async do<Req extends RpcReq, Res extends RpcRes>(methodName: string, req: Req): Promise<Res> {
        let response = null;
        let responseHeaders = null;
        try {
            const requestHeaders: { [key: string]: string } = {};
            if (this.authToken !== null) {
                requestHeaders[ServiceServer.AUTH_TOKEN_HEADER] = this.authToken;
            }
            const axiosResponse = await this.transporter.post(`/method/${methodName}`, req, { headers: requestHeaders });
            response = axiosResponse.data as ServiceResponse<Res>;
            responseHeaders = axiosResponse.headers;
        } catch (e) {
            throw new ServiceClientError(ServiceResponseErrors.TRANSPORT_ERROR, e.toString());
        }

        if (response.code !== ServiceResponseErrors.OK) {
            throw new ServiceClientError(response.code, response.error as string);
        }

        const responseData = response.data as Res;

        if (!this.validateResponseData(responseData)) {
            throw new ServiceClientError(ServiceResponseErrors.RESPONSE_VALIDATION_ERROR, "Response validation");
        }

        if (responseHeaders.hasOwnProperty(ServiceServer.AUTH_TOKEN_HEADER)) {
            this.authToken = responseHeaders[ServiceServer.AUTH_TOKEN_HEADER];
        }

        console.log(responseData);
        console.log(responseHeaders);

        return responseData;
    }

    private validateResponseData<Res extends RpcRes>(_res: Res) {
        // TODO(horia141): figure out response validation!
        return true;
    }
}

type ServiceHandlerMethod<Auth, Req extends RpcReq, Res extends RpcRes> = (ctx: RpcContext<Auth>, req: Req) => Promise<Res>;

export interface ServiceHandlerMap {
    normal: Map<string, ServiceHandlerMethod<any, any, any>>;
    withAuth: Map<string, ServiceHandlerMethod<any, any, any>>;
}

export enum ServiceResponseErrors {
    OK = 0,
    JSON_PARSING_ERROR = 1000,
    REQUEST_VALIDATION_ERROR = 1000,
    REQUEST_MISSING_AUTH_TOKEN = 1001,
    REQUEST_INVALID_AUTH_TOKEN = 1002,
    TRANSPORT_ERROR = 2000,
    RESPONSE_VALIDATION_ERROR = 2001,
    HANDLER_ERROR = 3000
}

export interface ServiceResponse<Res extends RpcRes> {
    code: ServiceResponseErrors;
    error?: string;
    data?: Res;
}

export function rpcHandler<Auth, Req extends RpcReq, Res extends RpcRes>(proto: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<ServiceHandlerMethod<Auth, Req, Res>>): TypedPropertyDescriptor<ServiceHandlerMethod<Auth, Req, Res>> {
    if (descriptor.value === undefined) {
        throw new Error(`Cannot have an absent rpc handler ${propertyKey} for ${proto.constructor.name}`);
    }

    const originalMethod = descriptor.value;

    if (!proto.hasOwnProperty("__serviceHandler")) {
        (proto as any).__serviceHandler = {
            normal: new Map<string, ServiceHandlerMethod<any, any, any>>(),
            withAuth: new Map<string, ServiceHandlerMethod<any, any, any>>()
        } as ServiceHandlerMap;
    }

    (proto as any).__serviceHandler.normal.set(propertyKey, originalMethod);

    return descriptor;
}

export function rpcHandlerWithAuth<Auth, Req extends RpcReq, Res extends RpcRes>(proto: Object, propertyKey: string, descriptor: TypedPropertyDescriptor<ServiceHandlerMethod<Auth, Req, Res>>): TypedPropertyDescriptor<ServiceHandlerMethod<Auth, Req, Res>> {
    if (descriptor.value === undefined) {
        throw new Error(`Cannot have an absent rpc handler ${propertyKey} for ${proto.constructor.name}`);
    }

    const originalMethod = descriptor.value;

    if (!proto.hasOwnProperty("__serviceHandler")) {
        (proto as any).__serviceHandler = {
            normal: new Map<string, ServiceHandlerMethod<any, any, any>>(),
            withAuth: new Map<string, ServiceHandlerMethod<any, any, any>>()
        } as ServiceHandlerMap;
    }

    (proto as any).__serviceHandler.withAuth.set(propertyKey, originalMethod);

    return descriptor;
}

export class ServiceServer {

    private static readonly AUTH_TOKEN_LIFE_HOURS = 4;
    private static readonly AUTH_TOKEN_ENCRYPTION_KEY = "Big Secret";
    public static readonly AUTH_TOKEN_HEADER = "X-DSRPC-AUTH-TOKEN".toLowerCase();

    private readonly handlerMap: ServiceHandlerMap;

    public constructor(
        private readonly handler: object) {

        const proto = Object.getPrototypeOf(this.handler);

        if (proto.hasOwnProperty("__serviceHandler")) {
            this.handlerMap = (proto as any).__serviceHandler as ServiceHandlerMap;
        } else {
            this.handlerMap = {
                normal: new Map<string, ServiceHandlerMethod<any, any, any>>(),
                withAuth: new Map<string, ServiceHandlerMethod<any, any, any>>()
            };
        }
    }

    public buildRouter(): express.Application {
        const app = express();

        function decodeJson(req: express.Request, res: express.Response, next: express.NextFunction) {
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
            });
        }

        for (const [methodName, methodHandler] of this.handlerMap.normal.entries()) {

            app.post(`/method/${methodName}`, decodeJson, async (req: express.Request, res: express.Response) => {
                const requestData = req.body;

                if (!this.validateRequestData(requestData)) {
                    const response: ServiceResponse<any> = {
                        code: ServiceResponseErrors.REQUEST_VALIDATION_ERROR,
                        error: "Request validation"
                    };

                    res.json(response);
                    res.end();
                    return;
                }

                const ctx = RpcContext.buildWithNoAuth();

                try {
                    const responseData = await methodHandler.call(this.handler, ctx, requestData);
                    const response: ServiceResponse<any> = {
                        code: ServiceResponseErrors.OK,
                        data: responseData
                    };

                    if (ctx.hasAuth()) {
                        const jwtPayload = {
                            auth: ctx.getAuth(),
                            iat: ctx.getRightNow().unix(),
                            exp: ctx.getRightNow().add(ServiceServer.AUTH_TOKEN_LIFE_HOURS, "hours").unix()
                        };

                        const token = await new Promise<string>((resolve, reject) => {

                            jwt.sign(jwtPayload, ServiceServer.AUTH_TOKEN_ENCRYPTION_KEY, (err, jwtEncoded) => {
                                if (err) {
                                    return reject(new Error("Could not create auth token"));
                                }

                                resolve(jwtEncoded);
                            });
                        });

                        res.setHeader(ServiceServer.AUTH_TOKEN_HEADER, token);
                    }

                    res.json(response);
                    res.end();
                    return;
                } catch (e) {
                    const response: ServiceResponse<any> = {
                        code: ServiceResponseErrors.HANDLER_ERROR,
                        error: e.toString()
                    };

                    res.json(response);
                    res.end();
                    return;
                }
            });
        }

        for (const [methodName, methodHandler] of this.handlerMap.withAuth.entries()) {

            app.post(`/method/${methodName}`, decodeJson, async (req: express.Request, res: express.Response) => {

                const requestData = req.body;

                if (!this.validateRequestData(requestData)) {
                    const response: ServiceResponse<any> = {
                        code: ServiceResponseErrors.REQUEST_VALIDATION_ERROR,
                        error: "Request validation"
                    };

                    res.json(response);
                    res.end();
                    return;
                }

                const authToken = req.header(ServiceServer.AUTH_TOKEN_HEADER);

                if (authToken === undefined) {
                    const response: ServiceResponse<any> = {
                        code: ServiceResponseErrors.REQUEST_MISSING_AUTH_TOKEN,
                        error: "Missing auth token"
                    };

                    res.json(response);
                    res.end();
                    return;
                }

                let auth = null;
                try {
                    auth = await new Promise<any>((resolve, reject) => {
                        jwt.verify(authToken, ServiceServer.AUTH_TOKEN_ENCRYPTION_KEY, {}, (err: VerifyErrors, jwtDecoded: object | string) => {
                            if (err) {
                                return reject(err);
                            } else if (jwtDecoded instanceof String) {
                                return reject(new Error("Invalid JWT token format"));
                            } else if (!jwtDecoded.hasOwnProperty("auth")) {
                                return reject(new Error("Invalid JWT token contents"));
                            }

                            resolve((jwtDecoded as any).auth);
                        });
                    });
                } catch (e) {
                    const response: ServiceResponse<any> = {
                        code: ServiceResponseErrors.REQUEST_INVALID_AUTH_TOKEN,
                        error: e.toString()
                    };

                    res.json(response);
                    res.end();
                    return;
                }

                const ctx = RpcContext.buildWithAuth(auth);

                try {
                    const responseData = await methodHandler.call(this.handler, ctx, requestData);

                    const response: ServiceResponse<any> = {
                        code: ServiceResponseErrors.OK,
                        data: responseData
                    };

                    if (ctx.hasAuth()) {
                        const jwtPayload = {
                            auth: ctx.getAuth(),
                            iat: ctx.getRightNow().unix(),
                            exp: ctx.getRightNow().add(ServiceServer.AUTH_TOKEN_LIFE_HOURS, "hours").unix()
                        };

                        const token = await new Promise<string>((resolve, reject) => {

                            jwt.sign(jwtPayload, ServiceServer.AUTH_TOKEN_ENCRYPTION_KEY, (err, jwtEncoded) => {
                                if (err) {
                                    return reject(new Error("Could not create auth token"));
                                }

                                resolve(jwtEncoded);
                            });
                        });

                        res.setHeader(ServiceServer.AUTH_TOKEN_HEADER, token);
                    }

                    res.json(response);
                    res.end();
                    return;
                } catch (e) {
                    const response: ServiceResponse<any> = {
                        code: ServiceResponseErrors.HANDLER_ERROR,
                        error: e.toString()
                    };

                    res.json(response);
                    res.end();
                    return;
                }
            });
        }

        app.get("/info", (_req: express.Request, res: express.Response) => {
            let message = "";
            for (const methodName of Object.keys(this.handlerMap)) {
                message += `Method: ${methodName}`;
            }

            res.send(message);
            res.status(200);
            res.end();
        });

        return app;
    }

    private validateRequestData<Req extends RpcReq>(_req: Req) {
        // TODO(horia141): figure out some validation here!
        return true;
    }
}