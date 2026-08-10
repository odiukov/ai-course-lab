def warmup(x):
    raise NotImplementedError


def gamma_step(
    params,
    grads,
    lr=1e-3,
    betas=(0.9, 0.999),
):
    """Header spans several lines, exactly like adamw_step in p03-l06."""
    raise NotImplementedError


async def fetch_batch(loader):
    raise NotImplementedError


def cooldown(x):
    raise NotImplementedError
