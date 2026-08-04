export type ActionAccessLevel = "public" | "authenticated" | "owner" | "acl";
export type ActionType = "command";

export interface ActionSqlUses {
  queries?: readonly string[];
  mutations?: readonly string[];
}

export interface ActionInputSchema {
  type?: "object" | "string" | "number" | "boolean" | "array" | "unknown";
  required?: string[];
  properties?: Record<string, ActionInputSchema>;
  enum?: unknown[];
  nullable?: boolean;
  items?: ActionInputSchema;
}

export interface ActionUser {
  id: string;
  name?: string | null;
  role?: string | null;
}

export interface ActionContext {
  user: ActionUser;
  ownerId: string;
  now: Date;
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  mutate<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  transaction<T>(fn: () => Promise<T> | T): Promise<T>;
  notify: {
    send(to: string | string[], payload: Record<string, unknown>): Promise<unknown>;
  };
  log: {
    info(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
  };
}

type DeclaredNames<TNames> = TNames extends readonly (infer TName)[]
  ? Extract<TName, string>
  : never;

export interface ActionContextFor<TUses extends ActionSqlUses = ActionSqlUses> extends Omit<ActionContext, "query" | "mutate"> {
  query<T = unknown>(name: DeclaredNames<TUses["queries"]>, params?: Record<string, unknown>): Promise<T>;
  mutate<T = unknown>(name: DeclaredNames<TUses["mutations"]>, params?: Record<string, unknown>): Promise<T>;
}

export interface BackendActionDefinition<
  TInput = Record<string, unknown>,
  TResult = unknown,
  TUses extends ActionSqlUses = ActionSqlUses,
> {
  name?: string;
  type?: ActionType;
  input?: ActionInputSchema;
  access?: ActionAccessLevel;
  acl?: string[];
  uses?: TUses;
  handler(ctx: ActionContextFor<TUses>, input: TInput): Promise<TResult> | TResult;
}

export function defineAction<
  TInput = Record<string, unknown>,
  TResult = unknown,
  const TUses extends ActionSqlUses = ActionSqlUses,
>(
  definition: BackendActionDefinition<TInput, TResult, TUses>,
): BackendActionDefinition<TInput, TResult, TUses> {
  return definition;
}

export const schema = {
  object(properties: Record<string, ActionInputSchema>, required: string[] = []): ActionInputSchema {
    return { type: "object", properties, required };
  },
  string(options: Omit<ActionInputSchema, "type"> = {}): ActionInputSchema {
    return { type: "string", ...options };
  },
  number(options: Omit<ActionInputSchema, "type"> = {}): ActionInputSchema {
    return { type: "number", ...options };
  },
  boolean(options: Omit<ActionInputSchema, "type"> = {}): ActionInputSchema {
    return { type: "boolean", ...options };
  },
  array(items: ActionInputSchema): ActionInputSchema {
    return { type: "array", items };
  },
  unknown(): ActionInputSchema {
    return { type: "unknown" };
  },
};
