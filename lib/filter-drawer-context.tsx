"use client";

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";

interface FilterDrawerContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const FilterDrawerContext = createContext<FilterDrawerContextValue>({
  isOpen: false,
  open: () => {},
  close: () => {},
});

export function FilterDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <FilterDrawerContext.Provider
      value={{
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
      }}
    >
      {children}
    </FilterDrawerContext.Provider>
  );
}

export function useFilterDrawer() {
  return useContext(FilterDrawerContext);
}
