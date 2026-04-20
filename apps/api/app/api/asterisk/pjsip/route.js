"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = exports.GET = void 0;
var server_1 = require("next/server");
var connection_1 = require("@/lib/db/connection");
var AsteriskSettings_1 = require("@/lib/db/models/AsteriskSettings");
var AuditLog_1 = require("@/lib/db/models/AuditLog");
var rbac_1 = require("@/lib/auth/rbac");
function getAriBase() {
    return __awaiter(this, void 0, void 0, function () {
        var s;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, (0, connection_1.connectDb)()];
                case 1:
                    _b.sent();
                    return [4 /*yield*/, AsteriskSettings_1.AsteriskSettings.findOne({}).lean()];
                case 2:
                    s = _b.sent();
                    if (!s)
                        throw new Error('Asterisk not configured');
                    return [2 /*return*/, {
                            host: s.ariHost,
                            port: s.ariPort,
                            user: s.ariUser,
                            password: s.ariPassword,
                            ssl: (_a = s.ariSsl) !== null && _a !== void 0 ? _a : false,
                        }];
            }
        });
    });
}
function ariRequest(method, path, body) {
    var _this = this;
    return getAriBase().then(function (cfg) { return __awaiter(_this, void 0, void 0, function () {
        var scheme, url, auth;
        return __generator(this, function (_a) {
            scheme = cfg.ssl ? 'https' : 'http';
            url = "".concat(scheme, "://").concat(cfg.host, ":").concat(cfg.port, "/ari").concat(path);
            auth = "Basic ".concat(Buffer.from("".concat(cfg.user, ":").concat(cfg.password)).toString('base64'));
            return [2 /*return*/, fetch(url, __assign(__assign({ method: method, headers: { Authorization: auth, 'Content-Type': 'application/json' } }, (body !== undefined ? { body: JSON.stringify(body) } : {})), { signal: AbortSignal.timeout(10000) }))];
        });
    }); });
}
function ariGet(path) {
    return ariRequest('GET', path).then(function (r) { return r.json(); });
}
function ariPost(path, body) {
    return ariRequest('POST', path, body).then(function (r) { return r.json(); });
}
function ariDelete(path) {
    return ariRequest('DELETE', path).then(function () { return undefined; });
}
function ariPut(path, body) {
    return ariRequest('PUT', path, body).then(function (r) { return (r.status === 204 ? null : r.json()); });
}
// GET /api/asterisk/pjsip - list all PJSIP configuration
exports.GET = (0, rbac_1.withAuth)(function (_req, _user) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, endpoints, auths, aors, identifies, transports, err_1;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 2, , 3]);
                return [4 /*yield*/, Promise.all([
                        ariGet('/endpoint'),
                        ariGet('/auth'),
                        ariGet('/aor'),
                        ariGet('/identify'),
                        ariGet('/transport'),
                    ])];
            case 1:
                _a = _b.sent(), endpoints = _a[0], auths = _a[1], aors = _a[2], identifies = _a[3], transports = _a[4];
                return [2 /*return*/, server_1.NextResponse.json({
                        data: {
                            endpoints: endpoints,
                            auths: auths,
                            aors: aors,
                            identifies: identifies,
                            transports: transports,
                        },
                    })];
            case 2:
                err_1 = _b.sent();
                return [2 /*return*/, server_1.NextResponse.json({ error: String(err_1) }, { status: 500 })];
            case 3: return [2 /*return*/];
        }
    });
}); }, ['admin', 'user']);
// POST /api/asterisk/pjsip - create PJSIP endpoint with auth and aor
exports.POST = (0, rbac_1.withAuth)(function (req, user) { return __awaiter(void 0, void 0, void 0, function () {
    var body, endpointName, authName, aorName, transport, payload, result, authPayload, aorPayload, identifyPayload, endpointPayload, err_2;
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    return __generator(this, function (_q) {
        switch (_q.label) {
            case 0: return [4 /*yield*/, (0, connection_1.connectDb)()];
            case 1:
                _q.sent();
                return [4 /*yield*/, req.json()];
            case 2:
                body = _q.sent();
                endpointName = String((_a = body['endpoint']) !== null && _a !== void 0 ? _a : '').trim();
                authName = String((_b = body['auth']) !== null && _b !== void 0 ? _b : endpointName).trim();
                aorName = String((_c = body['aor']) !== null && _c !== void 0 ? _c : endpointName).trim();
                transport = String((_d = body['transport']) !== null && _d !== void 0 ? _d : 'udp').trim();
                if (!endpointName) {
                    return [2 /*return*/, server_1.NextResponse.json({ error: 'endpoint name is required' }, { status: 400 })];
                }
                payload = body['payload'];
                _q.label = 3;
            case 3:
                _q.trys.push([3, 11, , 12]);
                result = {};
                if (!(payload === null || payload === void 0 ? void 0 : payload['auth'])) return [3 /*break*/, 5];
                authPayload = __assign({ auth_type: 'userpass', password: String((_e = payload['password']) !== null && _e !== void 0 ? _e : ''), username: String((_f = payload['username']) !== null && _f !== void 0 ? _f : endpointName), nonce_type: 'MD5' }, (payload['md5_cred'] ? { md5_cred: String(payload['md5_cred']) } : {}));
                return [4 /*yield*/, ariPost("/auth/".concat(authName), authPayload)];
            case 4:
                _q.sent();
                result.auth = authName;
                _q.label = 5;
            case 5:
                aorPayload = {
                    contact: "sip:".concat((_g = payload === null || payload === void 0 ? void 0 : payload['contact']) !== null && _g !== void 0 ? _g : ''),
                    qualify_frequency: Number((_h = payload === null || payload === void 0 ? void 0 : payload['qualify_frequency']) !== null && _h !== void 0 ? _h : 60),
                    max_contacts: Number((_j = payload === null || payload === void 0 ? void 0 : payload['max_contacts']) !== null && _j !== void 0 ? _j : 1),
                    remove_existing: 'yes',
                };
                return [4 /*yield*/, ariPost("/aor/".concat(aorName), aorPayload)];
            case 6:
                _q.sent();
                result.aor = aorName;
                if (!(payload === null || payload === void 0 ? void 0 : payload['match'])) return [3 /*break*/, 8];
                identifyPayload = {
                    match: String(payload['match']).split(',').map(function (m) { return m.trim(); }),
                    endpoint: endpointName,
                };
                return [4 /*yield*/, ariPost("/identify/".concat(aorName), identifyPayload)];
            case 7:
                _q.sent();
                result.identify = identifyPayload;
                _q.label = 8;
            case 8:
                endpointPayload = {
                    endpoint: endpointName,
                    aors: [aorName],
                    auth: authName,
                    transport: transport,
                    disallow: String((_k = payload === null || payload === void 0 ? void 0 : payload['disallow']) !== null && _k !== void 0 ? _k : 'all'),
                    allow: String((_l = payload === null || payload === void 0 ? void 0 : payload['allow']) !== null && _l !== void 0 ? _l : 'ulaw'),
                    callerid: String((_m = payload === null || payload === void 0 ? void 0 : payload['callerid']) !== null && _m !== void 0 ? _m : "Dialer <".concat(endpointName, ">")),
                    mailboxes: String((_o = payload === null || payload === void 0 ? void 0 : payload['mailboxes']) !== null && _o !== void 0 ? _o : ''),
                    'named-physical-endpoint': 'endpoint',
                    device: 'Softphone',
                };
                return [4 /*yield*/, ariPost("/endpoint/".concat(endpointName), endpointPayload)];
            case 9:
                _q.sent();
                result.endpoint = endpointName;
                return [4 /*yield*/, AuditLog_1.AuditLog.create({
                        userId: user.sub,
                        action: 'asterisk.pjsip.create',
                        resource: 'PJSIP',
                        resourceId: endpointName,
                        metadata: result,
                        ip: (_p = req.headers.get('x-forwarded-for')) !== null && _p !== void 0 ? _p : '0.0.0.0',
                    })];
            case 10:
                _q.sent();
                return [2 /*return*/, server_1.NextResponse.json({ data: result }, { status: 201 })];
            case 11:
                err_2 = _q.sent();
                return [2 /*return*/, server_1.NextResponse.json({ error: String(err_2) }, { status: 500 })];
            case 12: return [2 /*return*/];
        }
    });
}); }, ['admin']);
