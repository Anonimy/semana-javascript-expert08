export default class Service {
  #url;

  constructor({ url }) {
    this.#url = url;
  }

  async uploadFile({ fileName, fileBuffer }) {
    const formData = new FormData();
    formData.append(fileName, fileBuffer);

    const response = await fetch(this.#url, { method: 'POST', body: formData });

    console.assert(response.ok, '[Service::uploadFile] OK', response);

    return response;
  }
}
