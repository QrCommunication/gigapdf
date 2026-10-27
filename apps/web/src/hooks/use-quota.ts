"use client";

import { useEffect, useState } from "react";
import { api, QuotaSummary } from "@/lib/api";

export function useQuota() {
  const [quota, setQuota] = useState<QuotaSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    api.getQuota()
      .then((data) => {
        if (mounted) {
          setQuota(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return { quota, loading };
}