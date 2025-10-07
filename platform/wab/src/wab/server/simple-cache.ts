import { DbMgr } from "@/wab/server/db/DbMgr";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";

export interface SimpleCache {
  get(key: string): Promise<string | undefined>;

  put(key: string, value: string): Promise<void>;
}

export class DynamoDbCache implements SimpleCache {
  constructor(private client: DynamoDBClient) {}

  async get(key: string): Promise<string | undefined> {
    const command = new GetItemCommand({
      TableName: "llm-cache",
      Key: { key: { S: key } },
    });
    const response = await this.client.send(command);
    if (response.Item?.["my-value"]?.S) {
      return response.Item["my-value"].S;
    } else {
      return undefined;
    }
  }

  async put(key: string, value: string): Promise<void> {
    const command = new PutItemCommand({
      TableName: "llm-cache",
      Item: { key: { S: key }, "my-value": { S: value } },
    });
    await this.client.send(command);
  }
}

export class DbMgrCache implements SimpleCache {
  constructor(private dbMgr: DbMgr) {}

  async get(key: string) {
    const entry = await this.dbMgr.tryGetKeyValue("copilot-cache", key);
    return entry?.value;
  }

  put(key: string, value: string) {
    return this.dbMgr.setKeyValue("copilot-cache", key, value);
  }
}

// Simple in-memory cache for development
export class InMemoryCache implements SimpleCache {
  private cache = new Map<string, { value: string; expires: number }>();
  private ttlMs: number;

  constructor(ttlMs: number = 15 * 60 * 1000) {
    // 15 minutes default
    this.ttlMs = ttlMs;
  }

  async get(key: string): Promise<string | undefined> {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async put(key: string, value: string): Promise<void> {
    this.cache.set(key, {
      value,
      expires: Date.now() + this.ttlMs,
    });
  }
}
