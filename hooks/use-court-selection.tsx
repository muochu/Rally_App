import { createContext, useContext, useState, ReactNode } from 'react';
import type { Court } from '@/lib/types';

type CourtSelectionContextType = {
  selectedCourt: Court | null;
  selectCourt: (court: Court | null) => void;
};

const CourtSelectionContext = createContext<CourtSelectionContextType | undefined>(undefined);

export function CourtSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedCourt, setSelectedCourt] = useState<Court | null>(null);

  return (
    <CourtSelectionContext.Provider
      value={{
        selectedCourt,
        selectCourt: setSelectedCourt,
      }}
    >
      {children}
    </CourtSelectionContext.Provider>
  );
}

export function useCourtSelection() {
  const context = useContext(CourtSelectionContext);
  if (!context) {
    throw new Error('useCourtSelection must be used within CourtSelectionProvider');
  }
  return context;
}
