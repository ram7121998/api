export const pagination = ({ total, page, perPage, baseUrl = "" }) => {
    const lastPage = Math.ceil(total / perPage);
    const currentPage = page > lastPage ? lastPage : page;
    const from = total === 0 ? null : (currentPage - 1) * perPage + 1;
    const to = total === 0 ? null : Math.min(currentPage * perPage, total);
    const makeUrl = (p) => p >= 1 && p <= lastPage
        ? `${baseUrl}?page=${p}&per_page=${perPage}`
        : null;
    const links = [];
    for (let i = 1; i <= lastPage; i++) {
        links.push({
            url: makeUrl(i),
            label: i.toString(),
            active: i === currentPage,
        });
    }
    return {
        current_page: currentPage,
        from,
        to,
        total_items: total,
        first_page_url: makeUrl(1),
        last_page: lastPage,
        last_page_url: makeUrl(lastPage),
        next_page_url: makeUrl(currentPage + 1),
        per_page: perPage,
        prev_page_url: makeUrl(currentPage - 1),
        links,
        path: baseUrl,
    };
};
