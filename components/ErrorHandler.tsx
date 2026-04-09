"use client";

import { useEffect } from "react";

export function ErrorHandler() {
  useEffect(() => {
    if (typeof window !== "undefined") {
      const sanitizeArgs = (args: any[]) => {
        return args.map((arg) => {
          if (arg instanceof HTMLElement) {
            return `<${arg.tagName.toLowerCase()} />`;
          }
          return arg;
        });
      };

      const originalConsoleError = console.error;
      console.error = (...args) => {
        originalConsoleError(...sanitizeArgs(args));
      };

      const originalConsoleWarn = console.warn;
      console.warn = (...args) => {
        originalConsoleWarn(...sanitizeArgs(args));
      };
      
      const originalConsoleLog = console.log;
      console.log = (...args) => {
        originalConsoleLog(...sanitizeArgs(args));
      };
    }
  }, []);

  return null;
}
