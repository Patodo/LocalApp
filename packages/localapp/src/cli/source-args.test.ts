import {expect, it} from "vitest";
import {parseLocalAppArgs} from "./args.js";
it("requires explicit source target and destination", () => {
 expect(parseLocalAppArgs(["app", "pull", "--profile", "online", "--name", "example", "--directory", "./checkout"])).toEqual({kind: "app-source", action: "pull", profile: "online", name: "example", directory: "./checkout"});
 expect(parseLocalAppArgs(["app", "push", "--profile", "online", "--directory", "."])).toEqual({kind: "app-source", action: "push", profile: "online", directory: "."});
 for (const args of [["app", "pull"], ["app", "push", "--directory", "."], ["app", "pull", "--profile", "online", "--directory", "."], ["app", "push", "--profile", "online", "--directory", ".", "--owner", "someone"]]) expect(() => parseLocalAppArgs(args)).toThrow();
});
