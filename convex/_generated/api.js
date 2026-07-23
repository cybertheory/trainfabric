/* eslint-disable */
/**
 * Minimal stubs so the repo typechecks before `npx convex dev` generates real files.
 * Replace by running: npx convex dev
 */
export const api = {
  datasets: {
    lookupCache: "datasets:lookupCache" as any,
    upsertCacheEntry: "datasets:upsertCacheEntry" as any,
    getDatasetService: "datasets:getDatasetService" as any,
    listDatasetsService: "datasets:listDatasetsService" as any,
    createDatasetEntryService: "datasets:createDatasetEntryService" as any,
    updateDatasetAfterIngest: "datasets:updateDatasetAfterIngest" as any,
    setJobStatus: "datasets:setJobStatus" as any,
    getJob: "datasets:getJob" as any,
  },
};

export const internal = {
  datasets: {
    seedDemoDatasets: "datasets:seedDemoDatasets" as any,
  },
};
