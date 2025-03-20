import { message } from "antd";
import { getAccessToken } from "@/api/auth";

type Interceptor = {
  request?: (config: RequestInit) => RequestInit;
  response?: (response: Response) => Promise<any>;
};

class HttpRequest {
  private baseURL: string;
  private timeout: number;
  private interceptors: Interceptor;
  constructor(config: { baseURL: string; timeout?: number }) {
    this.baseURL = config.baseURL;
    this.timeout = config.timeout || 10000;
    this.interceptors = { request: undefined, response: undefined };
  }

  use(interceptors: Interceptor) {
    this.interceptors = { ...this.interceptors, ...interceptors };
  }
  async request<T>(url: string, config: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const mergedConfig = this.interceptors.request
        ? this.interceptors.request(config)
        : config;

      const access_token = localStorage.getItem("AccessToken");
      const fullUrl = `${this.baseURL}${url}`;
      const response = await fetch(fullUrl, {
        ...mergedConfig,
        headers: {
          ...mergedConfig.headers,
          ...(access_token ? { Authorization: access_token } : {}),
        },
        signal: controller.signal,
      });

      let resdata = await response.json();
      if (resdata.code === 200) {
        resdata = resdata.data;
      } else {
        if (resdata.message.includes("token has expired")) {
          await getAccessToken();
        }
        message.error(resdata.message);
      }
      return resdata;
    } catch (error) {
      message.error((error as Error).message || "Request failed");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  get<T>(url: string, config?: RequestInit): Promise<T> {
    return this.request(url, { ...config, method: "GET" });
  }

  post<T>(url: string, data?: T, config?: RequestInit): Promise<T> {
    return this.request(url, {
      ...config,
      method: "POST",
      headers: { "Content-Type": "application/json", ...config?.headers },
      body: JSON.stringify(data),
    });
  }
}

const http = new HttpRequest({
  baseURL: '/api',
  timeout: 15000,
});

http.use({
  request: (config) => {
    const access_token = localStorage.getItem("access_token");
    return {
      ...config,
      headers: {
        ...config.headers,
        ...(access_token ? { Authorization: access_token } : {}),
      },
    };
  },
  response: async (response) => {
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || "Request failed");
    }
    return response.json();
  },
});

export { http };
