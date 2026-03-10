import { getCauldronPools } from '../src/index.js';

describe('Cauldron API Test', () => {
  it('Get Active Furu pools', async() => {
    const furuTokenId = "d9ab24ed15a7846cc3d9e004aa5cb976860f13dac1ead05784ee4f4622af96ea"
    const cauldronPools = await getCauldronPools(furuTokenId)

    expect(Array.isArray(cauldronPools)).toBe(true)
  });

  it('Get Active chipnet pools', async() => {
    const chipnetTokenId = "53636bc8c1afbe35a7ba169eadfac0aebadeacf96954a9a066a483e885580ed4"
    const cauldronPools = await getCauldronPools(chipnetTokenId, 'chipnet')

    expect(Array.isArray(cauldronPools)).toBe(true)
  });
});