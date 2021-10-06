require("ts-node/register");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const flatten = require("flat");
const {Command} = require("commander");
import * as _ from "lodash";
import * as path from "path";
import {Request} from "express";
import {ParsedQs} from "qs";
import {APIGatewayProxyEventBase, SQSEvent, Context} from "aws-lambda";
import {APIGatewayProxyEventHeaders, APIGatewayProxyEventQueryStringParameters} from "aws-lambda/trigger/api-gateway-proxy";
import {SQSMessageAttribute} from "aws-lambda/trigger/sqs";

interface SqsLocalRequest {
    message: object;
    region?: string;
    account?: string;
    name?: string;
    message_Id?: string;
    attributes?: {[name: string]: SQSMessageAttribute};
}

function getSqsRequest(req: Request): Partial<SQSEvent> {
    const now = new Date();

    const body: SqsLocalRequest = req.body;

    if (_.isNil(body.message)) {
        throw Error(`Invalid sqs message`);
    }

    const awsRegion = body.region ?? "us-east-2";
    const awsAccount = body.account ?? "1234567890";
    const awsName = body.name ?? "local-queue";
    return {
        Records: [
            {
                messageId: body.message_Id ?? getRandomId(),
                receiptHandle: body.message_Id ?? getRandomId(),
                body: JSON.stringify(body.message),
                attributes: {
                    ApproximateReceiveCount: "1",
                    SentTimestamp: (+now).toString(),
                    SenderId: getRandomId(),
                    ApproximateFirstReceiveTimestamp: (+now + 1).toString(),
                },
                messageAttributes: body.attributes ?? {},
                md5OfBody: new Buffer(JSON.stringify(body.message)).toString("base64"),
                eventSource: "aws:sqs",
                eventSourceARN: `arn:aws:sqs:${awsRegion}:${awsAccount}:${awsName}`,
                awsRegion: awsRegion,
            },
        ],
    };
}

function getApiGatewayRequest(req: Request): Partial<APIGatewayProxyEventBase<any>> {
    const method = req.method.toUpperCase();
    const path = req?.params ? req.params[0] : null;
    const now = new Date();

    let body = "";

    const contentType = req.headers["content-type"]?.toLowerCase() ?? "";
    switch (true) {
        case contentType.includes("json"):
            body = JSON.stringify(req.body ?? {});
            break;
        case contentType.includes("xml"):
            body = req.body ?? "";
            break;
        case contentType.includes("plain"):
            body = req.body ?? "";
            break;
    }
    const url = req.url.includes("?") ? req.url.split("?")[0] : req.url;

    return {
        body: body,
        resource: "/api/v1/{proxy+}",
        path: url,

        httpMethod: method,
        queryStringParameters: getQueryParams(req.query),
        pathParameters: {
            proxy: url,
        },
        headers: req.headers as APIGatewayProxyEventHeaders,
        requestContext: {
            accountId: getRandomId(5),
            apiId: getRandomId(10),
            authorizer: {},
            resourceId: getRandomId(7),
            identity: null,
            stage: "dev",
            requestId: getRandomId(),
            requestTime: now.toISOString(),
            requestTimeEpoch: +now,
            path: path,
            resourcePath: url,
            httpMethod: method,
            protocol: req.protocol,
        },
    };
}

function getQueryParams(queryParams: ParsedQs): APIGatewayProxyEventQueryStringParameters {
    const queryStringParameters: APIGatewayProxyEventQueryStringParameters = {};

    if (_.isNil(queryParams)) {
        return queryStringParameters;
    }
    const flattenParams = flatten(queryParams);

    _.forOwn(flattenParams, (value, key) => {
        if (!key.includes(".")) {
            queryStringParameters[key] = value;
        } else {
            const keyArray = key.split(".");
            const parentParam = keyArray.splice(0, 1)[0];

            const childParams = "[" + keyArray.join("][") + "]";
            queryStringParameters[parentParam + childParams] = value;
        }
    });
    return queryStringParameters;
}

function getRandomId(length: number = 30): string {
    return _.times(length, () => _.random(35).toString(36)).join("");
}

function getExpressRoute(route: string): string {
    return replaceAll(replaceAll(route, "{", ":"), "}", "");
}

function replaceAll(str: string, find: string, replace: string): string {
    return str.replace(new RegExp(find, "g"), replace);
}

function saveJsonParser(data: string): object | string {
    try {
        return JSON.parse(data);
    } catch (e) {
        return data;
    }
}

function initServer(lambdaPath: string, handleName: string, port: number, routes: Array<string>, mode: string, debug: boolean): void {
    const allowedHttpMethod = ["get", "patch", "put", "delete", "post"];
    const app = express();

    app.use(
        bodyParser.urlencoded({
            extended: true,
        })
    );
    app.use(bodyParser.json({type: ["application/vnd.api+json", "application/json"]}));
    app.use(cors());

    const lambdaFunction = require(lambdaPath);

    switch (mode.toLowerCase()) {
        case "api":
            if (routes.length > 0) {
                for (let route of routes) {
                    const parseRoute = route.split("#");

                    if (parseRoute.length != 2) {
                        throw Error(`Invalid route ${route}`);
                    }

                    const method = parseRoute[0].toLowerCase();

                    if (!allowedHttpMethod.includes(method)) {
                        throw Error(`Invalid http method ${method}`);
                    }

                    app[method](getExpressRoute(parseRoute[1]), async (req, res) => {
                        const result = await lambdaFunction[handleName](getApiGatewayRequest(req),{} as Context);
                        await res.status(result.statusCode).json(saveJsonParser(result?.body ?? {}));
                    });
                }
            } else {
                app.all("/*", async (req, res) => {
                    const result = await lambdaFunction[handleName](getApiGatewayRequest(req),{} as Context);
                    await res.status(result.statusCode).json(saveJsonParser(result?.body ?? {}));
                });
            }
            break;

        case "sqs":
            app.all("/*", async (req, res) => {
                try {
                    const message = getSqsRequest(req);
                    if (debug) {
                        console.log(`sqs request`, req.body);
                        console.log(`sqs parsed`, message);
                    }

                    const result = await lambdaFunction[handleName](message);

                    await res.status(200).json(saveJsonParser(result ?? {}));
                } catch (e) {
                    await res.status(500).json(e.message);
                }
            });
            break;

        default:
            throw Error(`Invalid mode "${mode}" found`);
    }

    app.listen(port, () => {
        console.log(`Mode: ${mode}`);
        console.log(`listening in ${port}`);
    });
}

async function main(): Promise<void> {
    const program = new Command();

    program
        .requiredOption("-f --file <file>", "file path from project root")
        .option("-p --port [port]", `Specify port to use [3000]`, 3000)
        .option("-h --handleName [handleName]", `Specify handle to use [handler]`, "handler")
        .option("-r --routes [routes...]", `API routes . format ->  METHOD#ROUTE. example -> GET#/ping/:id`, [])
        .option("-d --debug [debug]", `debug mode`)
        .option("-m --mode [mode]", `api and sql modes allowed`, "api")
        .parse(process.argv);
    const lambdaPath = path.join(process.cwd(), program.opts().file);
    initServer(lambdaPath, program.opts().handleName, program.opts().port, program.opts().routes, program.opts().mode, program.opts().debug == true);
}

export default {run: main};
