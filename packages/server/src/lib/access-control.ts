import { isUserInGroup } from "./meta-sqlite.js";
import { setGroupMembershipResolver } from "@localapp/server-core";

setGroupMembershipResolver(isUserInGroup);

export * from "@localapp/server-core";
