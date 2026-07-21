const unavailable = async (): Promise<never> => {
  throw new Error('This production capability is not available in the public Design Space build.');
};

export const generateProductForgeArtifacts = unavailable;
export const packageProductForgeZip = unavailable;
