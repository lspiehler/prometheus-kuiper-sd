const express = require('express');
const router = express.Router();
const url = require("url");
const https = require('../lib/http');
var credentialcache = {}

router.get('/', function(req, res, next) {
    if (!req.headers.authorization || req.headers.authorization.indexOf('Basic ') === -1) {
        res.setHeader("WWW-Authenticate", "Basic realm=\"prometheus-kuiper-sd\"");
        //res.setHeader("HTTP/1.0 401 Unauthorized");
        res.status(401).json({
            error: {
                code: 401,
                message: 'Missing Authorization Header'
            }
        });
        return;
    }
    let parsecreds = Buffer.from(req.headers.authorization.substring(6), 'base64').toString().split(':')
    let creds = {
        username: parsecreds[0],
        password: parsecreds[1]
    }
    //let bufferObj = Buffer.from(req.headers.authorization.substring(6), "utf8");
    //console.log(creds);
    let labels = [];
    if(req.query.hasOwnProperty('labels')) {
        labels = req.query.labels.split(',');
    }
    let maintanancemode = 'any';
    if(req.query.hasOwnProperty('maintanancemode')) {
        maintanancemode = req.query.maintanancemode;
    }
    let targeturl;
    if(req.query.hasOwnProperty('target') === false) {
        res.status(400).json({
            error: {
                code: 400,
                message: 'A target must be specified'
            }
        });
        return;
    }
    if(req.query.hasOwnProperty('application') === false) {
        res.status(400).json({
            error: {
                code: 400,
                message: 'A application must be specified'
            }
        });
        return;
    }
    targeturl = url.parse(req.query.target);
    //console.log(targeturl);
    if(targeturl.protocol!='https:') {
        res.status(400).json({
            error: {
                code: 400,
                message: 'Target should be an https URL'
            }
        });
        return;
    }
    if(targeturl.port) {
        //port = targeturl.port
    } else {
        targeturl.port = 443;
    }
    credentialHandler({query: req.query, creds: creds, url: targeturl}, false, function(err, cred) {
        if(err) {
            res.setHeader("WWW-Authenticate", "Basic realm=\"prometheus-kuiper-sd\"");
            //res.setHeader("HTTP/1.0 401 Unauthorized");
            res.status(401).json({
                error: {
                    code: 401,
                    message: err
                }
            });
            return;
        } else {
            let options = {
                host: targeturl.host,
                port: targeturl.port,
                rejectUnauthorized: false,
                path: '/Kuiper/api/machines/v2?application=' + req.query.application,
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + cred.token
                }
            }
            https.request({ options: options }, function(err, resp) {
                if(err) {
                    res.json(resp);
                    //172.28.220.158
                } else {
                    let data = JSON.parse(resp.body);
                    let prometheusjson = normalize(data.data, {
                        labels: labels,
                        maintanancemode: maintanancemode
                    });
                    res.setHeader('X-Prometheus-Refresh-Interval-Seconds', '120');
                    res.json(prometheusjson);
                }
            });
        }
    });
});

var normalize = function(data, options) {
    let kt = [];
    for(let i = 0; i < data.length; i++) {
        let labels = [];
        for(let j = 0; j < options.labels.length; j++) {
            if(data[i].attributes.hasOwnProperty(options.labels[j])) {
                if(data[i].attributes[options.labels[j]]) {
                    labels.push(data[i].attributes[options.labels[j]]);
                }
            } else {
                labels.push('');
            }
        }
        if(options.maintanancemode == 'any' || data[i].attributes.maintenanceMode.toLowerCase() == options.maintanancemode.toLowerCase()) {
            kt.push({
                target: data[i].attributes.name.toLowerCase(),
                labels: labels
            });
        }
    }
    //console.log(kt);
    let labelht = {};
    for(let i = 0; i < kt.length; i++) {
        let labelhash = kt[i].labels.join('')
        if(labelht.hasOwnProperty(labelhash) == false) {
            let commonlabels = {}
            for(let j = 0; j < options.labels.length; j++) {
                if(kt[i].labels[j]!='') {
                    commonlabels[options.labels[j]] = kt[i].labels[j];
                }
            }
            labelht[labelhash] = {
                targets: [kt[i].target],
                labels: commonlabels
            }
        } else {
            labelht[labelhash].targets.push(kt[i].target);
        }
    }
    //console.log(labelht);
    let targets = [];
    let labelgroups = Object.keys(labelht);
    for(let i = 0; i < labelgroups.length; i++) {
        let targetgroup = {
            targets: labelht[labelgroups[i]].targets, 
            //labels: labelht[labelgroups[i]].labels
        }
        let labelkeys = Object.keys(labelht[labelgroups[i]].labels);
        if(labelkeys.length > 0) {
            targetgroup.labels = labelht[labelgroups[i]].labels;
        }
        //console.log(labelht[labelgroups[i]].labels);
        targets.push(targetgroup);
    }
    return targets;
}

var credentialHandler = function(params, force, callback) {
    if(credentialcache.hasOwnProperty(params.query.target) && force == false) {
        let time = new Date().getTime();
        //console.log(time);
        if(credentialcache[params.query.target].expiration - 300000 > time) {
            console.log('credentials are cached and valid');
            callback(false, credentialcache[params.query.target]);
        } else {
            console.log('credentials are cached and expired');
            credentialHandler(params, true, callback);
        }
    } else {
        //console.log(params);
        console.log('failed to find credentials in cache');
        //callback('test2', false);
        //return;
        let body = {
            username: params.creds.username,
            password: params.creds.password,
            grant_type: "password",
            client_id: "41cdcd0f-47e6-4f85-9d57-f74a7dfbaed8"
        }
        let options = {
            host: params.url.host,
            port: params.url.port,
            rejectUnauthorized: false,
            path: '/Kuiper/api/v1/auth',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: body
        }
        https.request({ options: options, body: body }, function(err, resp) {
            if(err) {
                console.log(err);
                callback(err, false);
            } else {
                let body = JSON.parse(resp.body);
                let time = new Date().getTime();
                let token = {
                    token: body.token,
                    expiration: time + parseInt(body.expires_in)
                }
                credentialcache[params.query.target] = token;
                callback(false, token);
            }
        });
    }
}

module.exports = router;