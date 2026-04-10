"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const config_1 = require("../src/config");
(0, vitest_1.describe)("resolveModelConfig", () => {
    (0, vitest_1.test)("returns matching model", () => {
        const mf = {
            models: [
                { id: "a", adapter: "ollama", baseUrl: "http://x", model: "m" },
                { id: "b", adapter: "openai_compatible", baseUrl: "http://y", model: "n" },
            ],
        };
        (0, vitest_1.expect)((0, config_1.resolveModelConfig)(mf, "b").baseUrl).toBe("http://y");
    });
    (0, vitest_1.test)("throws 400 on unknown model", () => {
        const mf = {
            models: [{ id: "a", adapter: "ollama", baseUrl: "http://x", model: "m" }],
        };
        try {
            (0, config_1.resolveModelConfig)(mf, "missing");
            throw new Error("expected throw");
        }
        catch (err) {
            (0, vitest_1.expect)(err.statusCode).toBe(400);
            (0, vitest_1.expect)(String(err.message)).toContain("Unknown model");
        }
    });
});
