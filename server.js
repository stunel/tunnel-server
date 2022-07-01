import log from 'book';
import Koa from 'koa';
import tldjs from 'tldjs';
import Debug from 'debug';
import http from 'http';
import { hri } from 'human-readable-ids';
import Router from 'koa-router';

import ClientManager from './lib/ClientManager';

const debug = Debug('localtunnel:server');

const globalBrands = [
    'Amazon', 'Apple', 'Google', 'Microsoft', 'Tencent', 'Facebook', 'Alibaba',
    'visa', 'McDonald', 'Mastercard', 'Verizon', 'CocaCola', 'Instagram', 'PayPal', 
    'Netflix', 'Walmart', 'Disney', 'Salesforce', 'YouTube', 'Samsung', 'TikTok',
    'Tesla', 'Huawei', 'Linkedin', 'Vodafone', 'AmericanExpress', 'WellsFargo',
    'Toyota', 'Xiaomi', 'Dell', 'JPMorgan', 'Adidas', 'Uber', 'Snapchat', 'BankofAmerica',
    'Commonwealth', 'Spotify', 'UnitedHealthCare', 'Fedex', 'Adidas', 'Chase',
    'ChinaMobile', 'Mercedes', 'Xbox', 'Zoom', 'Spectrum', 'Qualcomm', 'Accenture',
    'Oracle', 'Starbucks', 'Adobe', 'Nike'
]

export default function(opt) {
    opt = opt || {};

    const validHosts = (opt.domain) ? [opt.domain] : undefined;
    const myTldjs = tldjs.fromUserSettings({ validHosts });
    const landingPage = opt.landing || 'https://github.com/stunel/tunnel-client';

    function GetClientIdFromHostname(hostname) {
        return myTldjs.getSubdomain(hostname);
    }

    const manager = new ClientManager(opt);

    const schema = opt.secure ? 'https' : 'http';

    const app = new Koa();
    const router = new Router();

    router.get('/api/status', async (ctx, next) => {
        const stats = manager.stats;
        ctx.body = {
            tunnels: stats.tunnels,
            mem: process.memoryUsage(),
        };
    });

    router.get('/api/tunnels/:id/status', async (ctx, next) => {
        const clientId = ctx.params.id;
        const client = manager.getClient(clientId);
        if (!client) {
            ctx.throw(404);
            return;
        }

        const stats = client.stats();
        ctx.body = {
            connected_sockets: stats.connectedSockets,
        };
    });

    router.get('/:id/:password', async (ctx, next) => {

        try{
            const reqId = ctx.params.id;
            const password = ctx.params.password;
            const ip = ctx.request.ip;
    
            // limit requested hostnames to 63 characters
            if (! /^(?:[a-z0-9][a-z0-9\-]{4,63}[a-z0-9]|[a-z0-9]{4,63})$/.test(reqId)) {
                const msg = 'Invalid subdomain. Subdomains must be lowercase and between 4 and 63 alphanumeric characters.';
                ctx.status = 403;
                ctx.body = {
                    message: msg,
                };
                return;
            }

            //check if the subdomain starts with global brand name
            const error = new Error();
            globalBrands.forEach(brand => {
                if(reqId.startsWith(brand.toLowerCase())){
                    error.message = `This is a possible phishing attack on a global brand ${brand}. Subdomain should not start with the name of a global brand`;
                    error.status = 403;
                }
            })

            if(error.message){
                const msg = error.message;
                ctx.status = error.status;
                ctx.body = {
                    message: msg,
                };
                return;
            }
    
            debug('making new client with id %s', reqId);
    
            const info = await manager.newClient(reqId, password, ip);
    
            const url = schema + '://' + info.id + '.' + ctx.request.host;
            info.url = url;
            ctx.body = info;
            return;
        }
        catch(err){
            const msg = err.message;
            ctx.status = err.code || 400;
            ctx.body = {
                message: msg,
            };
            return;
        }
    });

    router.get('/', async (ctx, next) => {

        //send to landing page
        ctx.redirect(landingPage);
    });

    app.use(router.routes());
    app.use(router.allowedMethods());

    const server = http.createServer();

    const appCallback = app.callback();

    server.on('request', (req, res) => {
        // without a hostname, we won't know who the request is for
        const hostname = req.headers.host;
        if (!hostname) {
            res.statusCode = 400;
            res.end('Host header is required');
            return;
        }

        const clientId = GetClientIdFromHostname(hostname);
        if (!clientId) {
            appCallback(req, res);
            return;
        }

        const client = manager.getClient(clientId);
        if (!client) {
            res.statusCode = 404;
            res.end('404');
            return;
        }

        client.handleRequest(req, res);
    });

    server.on('upgrade', (req, socket, head) => {
        const hostname = req.headers.host;
        if (!hostname) {
            socket.destroy();
            return;
        }

        const clientId = GetClientIdFromHostname(hostname);
        if (!clientId) {
            socket.destroy();
            return;
        }

        const client = manager.getClient(clientId);
        if (!client) {
            socket.destroy();
            return;
        }

        client.handleUpgrade(req, socket);
    });

    return server;
};
