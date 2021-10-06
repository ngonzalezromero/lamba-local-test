# Local Lambda

This tool will help you running lambdas on you local environment, enabling you to test, develop and debug locally. Powered by [express](https://www.npmjs.com/package/express).

## Installation

`npm i @vacasa/lambda-local`

## Usage

`lambda-local` can be executed from command line with te following arguments:

```
-f    File path from project root.
-p    Port Specify port to use. [3000]
-h    Handle function to use. [handler]
-r    Api routes . format ->  METHOD#ROUTE. example -> GET#/ping/:id
-m    Modes allowed: api, sqs [api]
-d    Debug mode
```

## Modes

Currently `lambda-local` supports two modes:

`api` is the default mode and emulates an `ApiGatewayEvent`
`sqs` emulates an `SQS Event`.

### API Mode

This is the default mode, the following `package.json` config should be enough to have it running:

```json
{
  "name": "lambda-local-test",
  "version: "1.0.0",
  "routes": [
    "GET#/foo",                              
    "GET#/bar", 
  ],
  "scripts": {
    "server": "lambda-local -p 3100 -f ./src/handler.ts -r $npm_package_routes"
  },
  "devDependencies": {
      "@vacasa/lambda-local": "*"
  }
}
```

This will listen locally on both endpoints:

`GET localhost:3100/foo`
`GET localhost:3100/bar`

and will generate an `ApiGatewayProxyEvent` on every request.

But there's more :rocket: ! `lambda-local` and [lambaa](https://www.npmjs.com/package/lambaa) :sheep: play along! Below you will find a `lambaa` handler to consume our `foo`, `bar` endpoints.

```js
import {Router, Controller, GET} from "lambaa"; 
 
@Controller
class FooBarController{
    @GET("foo")
    public async getFoo(){
        return {statusCode: 200, body: "bar"};
    }
    public async getBar(){
        return {statusCode: 200, body: "foo"};
    }
} 
export const handler = new Router().registerController(new FooBarController());
```


### SQS mode

*TODO...*
