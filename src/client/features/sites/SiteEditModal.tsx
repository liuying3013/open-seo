import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/client/components/Modal";
import {
  DEFAULT_LOCATION_CODE,
  getLanguageCode,
} from "@/client/features/keywords/locations";
import { ProjectMarketFields } from "@/client/features/projects/ProjectMarketFields";
import { ROLE_LABELS, STATUS_LABELS } from "@/client/features/sites/siteLabels";
import type { SiteOverviewRow } from "@/client/features/sites/types";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { updateSiteRow } from "@/serverFunctions/site-registry";
import { SITE_OPS_STATUSES, SITE_ROLES } from "@/shared/siteRegistry";

type MarketDraft = {
  locationCode: number;
  languageCode: string;
  urlPrefix: string;
  isPrimary: boolean;
};

export function SiteEditModal({
  site,
  onClose,
}: {
  site: SiteOverviewRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const registry = site.registry;
  const [businessGroup, setBusinessGroup] = React.useState(
    registry?.businessGroup ?? "",
  );
  const [brand, setBrand] = React.useState(registry?.brand ?? "");
  const [siteRole, setSiteRole] = React.useState(registry?.siteRole ?? "other");
  const [opsStatus, setOpsStatus] = React.useState(
    registry?.opsStatus ?? "pending",
  );
  const [notes, setNotes] = React.useState(registry?.notes ?? "");
  const [markets, setMarkets] = React.useState<MarketDraft[]>(
    site.markets.map((market) => ({
      locationCode: market.locationCode,
      languageCode: market.languageCode,
      urlPrefix: market.urlPrefix ?? "",
      isPrimary: market.isPrimary,
    })),
  );

  const patchMarket = (index: number, patch: Partial<MarketDraft>) =>
    setMarkets((current) =>
      current.map((market, i) =>
        i === index ? { ...market, ...patch } : market,
      ),
    );

  const saveMutation = useMutation({
    mutationFn: () =>
      updateSiteRow({
        data: {
          projectId: site.projectId,
          businessGroup,
          brand,
          siteRole,
          opsStatus,
          notes,
          markets: markets.map((market) => ({
            locationCode: market.locationCode,
            languageCode: market.languageCode,
            urlPrefix: market.urlPrefix,
            isPrimary: market.isPrimary,
          })),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sites"] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Site saved");
      onClose();
    },
    onError: (error) =>
      toast.error(getStandardErrorMessage(error, "Failed to save site")),
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (saveMutation.isPending) return;
    const keys = markets.map((m) => `${m.locationCode}/${m.languageCode}`);
    if (new Set(keys).size !== keys.length) {
      toast.error("Each market can only be listed once");
      return;
    }
    if (markets.length > 0 && !markets.some((market) => market.isPrimary)) {
      toast.error("Choose a primary market");
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Modal maxWidth="max-w-2xl" onClose={onClose} labelledBy="site-edit-title">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <h2 id="site-edit-title" className="text-lg font-semibold">
            {site.domain ?? site.name}
          </h2>
          <p className="text-sm text-base-content/60">
            Repository, hosting and data mappings are imported through the
            upsert_site_registry MCP tool.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Business group</span>
            <input
              className="input input-bordered w-full"
              value={businessGroup}
              onChange={(event) => setBusinessGroup(event.target.value)}
              maxLength={80}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Brand</span>
            <input
              className="input input-bordered w-full"
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              maxLength={80}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Role</span>
            <select
              className="select select-bordered w-full"
              value={siteRole}
              onChange={(event) => {
                const next = SITE_ROLES.find((r) => r === event.target.value);
                if (next) setSiteRole(next);
              }}
            >
              {SITE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Status</span>
            <select
              className="select select-bordered w-full"
              value={opsStatus}
              onChange={(event) => {
                const next = SITE_OPS_STATUSES.find(
                  (s) => s === event.target.value,
                );
                if (next) setOpsStatus(next);
              }}
            >
              {SITE_OPS_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Notes</span>
          <textarea
            className="textarea textarea-bordered w-full"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={2000}
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Markets</span>
          {markets.map((market, index) => (
            <div
              key={`${market.locationCode}/${market.languageCode}/${index}`}
              className="flex flex-col gap-2 rounded-lg border border-base-300 p-3"
            >
              <ProjectMarketFields
                value={market}
                onChange={(next) => patchMarket(index, next)}
              />
              <div className="flex items-center gap-3">
                <input
                  className="input input-bordered input-sm w-40"
                  placeholder="URL prefix, e.g. /ar"
                  value={market.urlPrefix}
                  onChange={(event) =>
                    patchMarket(index, { urlPrefix: event.target.value })
                  }
                  maxLength={80}
                />
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="primary-market"
                    className="radio radio-sm"
                    checked={market.isPrimary}
                    onChange={() =>
                      setMarkets((current) =>
                        current.map((m, i) => ({
                          ...m,
                          isPrimary: i === index,
                        })),
                      )
                    }
                  />
                  Primary
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm ml-auto"
                  aria-label="Remove market"
                  onClick={() =>
                    setMarkets((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-ghost btn-sm self-start"
            onClick={() =>
              setMarkets((current) => [
                ...current,
                {
                  locationCode: DEFAULT_LOCATION_CODE,
                  languageCode: getLanguageCode(DEFAULT_LOCATION_CODE),
                  urlPrefix: "",
                  isPrimary: current.length === 0,
                },
              ])
            }
          >
            <Plus className="size-4" />
            Add market
          </button>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <span className="loading loading-spinner loading-xs" />
            ) : null}
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
