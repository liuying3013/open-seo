import {
  OffersRepository,
  type OfferInput,
} from "../repositories/OffersRepository";

// Offers describe what the business can actually sell/fulfill; business-value
// scoring reads margin/readiness/priority from the offer a cluster serves.

async function list(projectId: string) {
  return OffersRepository.listByProject(projectId);
}

async function save(projectId: string, inputs: OfferInput[]) {
  const ids = await OffersRepository.saveMany(projectId, inputs);
  return { savedIds: ids };
}

export const OffersService = {
  list,
  save,
};
