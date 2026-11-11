import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase, useAuth } from "./NavioDashboard.jsx";

// Las personas de la empresa (sin correos): para asignar traslados y tareas,
// y para saber con quién se puede conversar. Se cargan una sola vez.
const PeopleContext = createContext({ people: [], byId: {}, loading: true, refresh: async () => {} });

export function usePeople() {
  return useContext(PeopleContext);
}

export const personName = (person) => person?.fullName?.trim() || "Sin nombre";

export function PeopleProvider({ children }) {
  const { profile } = useAuth();
  const companyId = profile?.companyId ?? null;
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase || !companyId) {
      setPeople([]);
      setLoading(false);
      return;
    }
    let { data, error } = await supabase
      .from("profiles")
      .select('id, "fullName", "companyRole", "jobTitle", phone')
      .eq("companyId", companyId)
      .order("fullName");
    // Antes de la migración v17 no existen puesto ni teléfono.
    if (error) ({ data } = await supabase.from("profiles").select('id, "fullName", "companyRole"').eq("companyId", companyId).order("fullName"));
    setPeople(data ?? []);
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ people, byId: Object.fromEntries(people.map((p) => [p.id, p])), loading, refresh }),
    [people, loading, refresh]
  );
  return <PeopleContext.Provider value={value}>{children}</PeopleContext.Provider>;
}
