import { onRequest as __api_cielo_js_onRequest } from "/Users/tomas/Documents/code/lightdashboard/functions/api/cielo.js"
import { onRequest as __api_coingecko_js_onRequest } from "/Users/tomas/Documents/code/lightdashboard/functions/api/coingecko.js"
import { onRequest as __api_proxy_js_onRequest } from "/Users/tomas/Documents/code/lightdashboard/functions/api/proxy.js"
import { onRequest as __api_pyth_js_onRequest } from "/Users/tomas/Documents/code/lightdashboard/functions/api/pyth.js"
import { onRequest as __api_yahoo_js_onRequest } from "/Users/tomas/Documents/code/lightdashboard/functions/api/yahoo.js"
import { onRequest as __api_zerion_js_onRequest } from "/Users/tomas/Documents/code/lightdashboard/functions/api/zerion.js"

export const routes = [
    {
      routePath: "/api/cielo",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_cielo_js_onRequest],
    },
  {
      routePath: "/api/coingecko",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_coingecko_js_onRequest],
    },
  {
      routePath: "/api/proxy",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_proxy_js_onRequest],
    },
  {
      routePath: "/api/pyth",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_pyth_js_onRequest],
    },
  {
      routePath: "/api/yahoo",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_yahoo_js_onRequest],
    },
  {
      routePath: "/api/zerion",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_zerion_js_onRequest],
    },
  ]